import type { TokenListItem } from "@/common/utils/tokenList"
import { findToken } from "@/swapService/utils"
import { Chains, type IFetchService } from "@balmy/sdk"
import type {
  BuildTxParams,
  IQuoteSource,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  addQuoteSlippage,
  calculateAllowanceTarget,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import { log } from "@uniswap/smart-order-router"
import qs from "qs"
import { type Address, getAddress, isAddressEqual } from "viem"

const soldOutCoolOff: Record<string, number> = {}

const SOLD_OUT_COOL_OFF_TIME = 60 * 60 * 1000

// https://api-v2.pendle.finance/core/docs#/Chains/ChainsController_getSupportedChainIds
export const PENDLE_METADATA: QuoteSourceMetadata<PendleSupport> = {
  name: "Pendle",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.MANTLE.chainId,
      Chains.BASE.chainId,
      Chains.ARBITRUM.chainId,
      Chains.BNB_CHAIN.chainId,
      146,
      80094,
    ],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "",
}
type PendleSupport = { buyOrders: false; swapAndTransfer: true }
type CustomOrAPIKeyConfig =
  | { customUrl: string; apiKey?: undefined }
  | { customUrl?: undefined; apiKey: string }
type PendleConfig = CustomOrAPIKeyConfig
type PendleData = { tx: SourceQuoteTransaction }

type ExpiredMarketsCache = {
  [chainId: number]: {
    lastUpdated: number
    markets: {
      name: string
      address: Address
      expiry: string
      pt: string
      yt: string
      sy: string
      underlyingAsset: string
    }[]
  }
}

const todayUTC = () => new Date().setUTCHours(0, 0, 0, 0)

export class CustomPendleQuoteSource
  implements IQuoteSource<PendleSupport, PendleConfig, PendleData>
{
  private expiredMarketsCache: ExpiredMarketsCache = {}

  getMetadata() {
    return PENDLE_METADATA
  }

  async quote(
    params: QuoteParams<PendleSupport, PendleConfig>,
  ): Promise<SourceQuoteResponse<PendleData>> {
    const { dstAmount, to, data } = await this.getQuote(params)
    const quote = {
      sellAmount: params.request.order.sellAmount,
      buyAmount: BigInt(dstAmount),
      allowanceTarget: calculateAllowanceTarget(params.request.sellToken, to),
      customData: {
        tx: {
          to,
          calldata: data,
        },
      },
    }

    return addQuoteSlippage(
      quote,
      params.request.order.type,
      params.request.config.slippagePercentage,
    )
  }

  async buildTx({
    request,
  }: BuildTxParams<PendleConfig, PendleData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }

  private async getQuote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout },
      accounts: { takeFrom, recipient },
    },
    config,
  }: QuoteParams<PendleSupport, PendleConfig>) {
    const tokenIn = findToken(chainId, getAddress(sellToken))
    const tokenOut = findToken(chainId, getAddress(buyToken))
    if (!tokenIn || !tokenOut) throw new Error("Missing token in or out")
    if (!tokenIn.meta?.isPendlePT && !tokenOut.meta?.isPendlePT) {
      failed(PENDLE_METADATA, chainId, sellToken, buyToken, "Not PT tokens")
    }
    let url
    if (tokenIn.meta?.isPendlePT && tokenOut.meta?.isPendlePT) {
      // rollover
      const queryParams = {
        receiver: recipient || takeFrom,
        slippage: slippagePercentage / 100, // 1 = 100%
        dstMarket: tokenOut.meta.pendleMarket,
        ptAmount: order.sellAmount.toString(),
      }

      const queryString = qs.stringify(queryParams, {
        skipNulls: true,
        arrayFormat: "comma",
      })

      const pendleMarket = tokenIn.meta.pendleMarket
      url = `${getUrl()}/sdk/${chainId}/markets/${pendleMarket}/roll-over-pt?${queryString}`
    } else if (
      tokenIn.meta?.isPendlePT &&
      !!(await this.getExpiredMarket(fetchService, chainId, tokenIn, timeout))
    ) {
      // redeem expired PT
      const market = await this.getExpiredMarket(
        fetchService,
        chainId,
        tokenIn,
        timeout,
      )
      const queryParams = {
        receiver: recipient || takeFrom,
        slippage: slippagePercentage / 100, // 1 = 100%
        enableAggregator: true,
        yt: market?.yt.slice(2),
        amountIn: order.sellAmount.toString(),
        tokenOut: buyToken,
      }

      const queryString = qs.stringify(queryParams, {
        skipNulls: true,
        arrayFormat: "comma",
      })

      url = `${getUrl()}/sdk/${chainId}/redeem?${queryString}`
    } else {
      if (
        Date.now() - soldOutCoolOff[`${buyToken}${chainId}`] <
        SOLD_OUT_COOL_OFF_TIME
      ) {
        failed(
          PENDLE_METADATA,
          chainId,
          sellToken,
          buyToken,
          "Sold out cool off",
        )
      }
      // swap
      const queryParams = {
        receiver: recipient || takeFrom,
        slippage: slippagePercentage / 100, // 1 = 100%
        enableAggregator: true,
        tokenIn: sellToken,
        tokenOut: buyToken,
        amountIn: order.sellAmount.toString(),
      }

      const queryString = qs.stringify(queryParams, {
        skipNulls: true,
        arrayFormat: "comma",
      })

      const pendleMarket =
        tokenIn?.meta?.pendleMarket || tokenOut?.meta?.pendleMarket

      url = `${getUrl()}/sdk/${chainId}/markets/${pendleMarket}/swap?${queryString}`
    }

    const response = await fetchService.fetch(url, {
      timeout,
      headers: getHeaders(config),
    })

    if (!response.ok) {
      const msg =
        (await response.text()) || `Failed with status ${response.status}`

      if (response.status === 400) {
        log({ name: "[PENDLE ERROR]", msg, recipient, url })

        if (msg.includes("SY limit exceeded")) {
          soldOutCoolOff[`${buyToken}${chainId}`] = Date.now()
        }
      }

      failed(PENDLE_METADATA, chainId, sellToken, buyToken, msg)
    }

    const {
      data: { amountOut, amountPtOut },
      tx: { to, data },
    } = await response.json()
    const dstAmount = amountOut || amountPtOut

    return { dstAmount, to, data }
  }

  private async getExpiredMarket(
    fetchService: IFetchService,
    chainId: number,
    token: TokenListItem,
    timeout?: string,
  ) {
    if (
      !this.expiredMarketsCache[chainId] ||
      this.expiredMarketsCache[chainId].lastUpdated !== todayUTC()
    ) {
      this.expiredMarketsCache[chainId] = {
        markets: [],
        lastUpdated: -1,
      }

      const url = `${getUrl()}/${chainId}/markets/inactive`
      const response = await fetchService.fetch(url, {
        timeout: timeout as any,
      })

      if (response.ok) {
        const { markets } = await response.json()

        this.expiredMarketsCache[chainId] = {
          markets,
          lastUpdated: todayUTC(),
        }
      }
    }

    return this.expiredMarketsCache[chainId].markets.find((m) =>
      isAddressEqual(m.address, token.meta?.pendleMarket as Address),
    )
  }

  isConfigAndContextValidForQuoting(
    config: Partial<PendleConfig> | undefined,
  ): config is PendleConfig {
    return true
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<PendleConfig> | undefined,
  ): config is PendleConfig {
    return true
  }
}

function getUrl() {
  return "https://api-v2.pendle.finance/core/v1"
}

function getHeaders(config: PendleConfig) {
  const headers: Record<string, string> = {
    accept: "application/json",
  }
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`
  }
  return headers
}
