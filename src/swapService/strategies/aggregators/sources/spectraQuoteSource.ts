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
import { arbitrum, avalanche, base, bsc, mainnet, optimism } from "viem/chains"

const SUPPORTED_CHAINS: Record<string, string> = {
  [mainnet.id]: "mainnet",
  [base.id]: "base",
  [optimism.id]: "optimism",
  [arbitrum.id]: "arbitrum",
  [avalanche.id]: "avalanche",
  [bsc.id]: "bsc",
  [999]: "hyperevm",
  [747474]: "katana",
  [146]: "sonic",
  [43111]: "hemi",
}

export const SPECTRA_METADATA: QuoteSourceMetadata<SpectraSupport> = {
  name: "Spectra",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "",
}
type SpectraSupport = { buyOrders: false; swapAndTransfer: true }
type SpectraConfig = object
type SpectraData = { tx: SourceQuoteTransaction }

type ExpiredPoolsCache = {
  [chainId: number]: {
    lastUpdated: number
    pools: string[]
  }
}

const todayUTC = () => new Date().setUTCHours(0, 0, 0, 0)

export class CustomSpectraQuoteSource
  implements IQuoteSource<SpectraSupport, SpectraConfig, SpectraData>
{
  private expiredPoolsCache: ExpiredPoolsCache = {}

  getMetadata() {
    return SPECTRA_METADATA
  }

  async quote(
    params: QuoteParams<SpectraSupport, SpectraConfig>,
  ): Promise<SourceQuoteResponse<SpectraData>> {
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
  }: BuildTxParams<
    SpectraConfig,
    SpectraData
  >): Promise<SourceQuoteTransaction> {
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
  }: QuoteParams<SpectraSupport, SpectraConfig>) {
    const tokenIn = findToken(chainId, getAddress(sellToken))
    const tokenOut = findToken(chainId, getAddress(buyToken))
    if (!tokenIn || !tokenOut) throw new Error("Missing token in or out")
    if (!tokenIn.metadata?.isSpectraPT && !tokenOut.metadata?.isSpectraPT) {
      failed(
        SPECTRA_METADATA,
        chainId,
        sellToken,
        buyToken,
        "Not Spectra PT tokens",
      )
    }
    let url
    if (tokenIn.metadata?.isSpectraPT && tokenOut.metadata?.isSpectraPT) {
      // rollover
      failed(SPECTRA_METADATA, chainId, sellToken, buyToken, "Not supported")
    } else if (
      tokenIn.metadata?.isSpectraPT &&
      (await this.isExpiredMarket(fetchService, chainId, tokenIn, timeout))
    ) {
      // redeem expired PT

      const queryParams = {
        receiver: recipient || takeFrom,
        slippage: slippagePercentage, // (0 to 100)
        tokenOut: buyToken,
        amountIn: order.sellAmount.toString(),
      }

      const queryString = qs.stringify(queryParams)

      url = `${getUrl(chainId)}/pts/${sellToken}/redeem?${queryString}`
    } else {
      // swap
      const queryParams = {
        tokenIn: sellToken,
        tokenOut: buyToken,
        receiver: recipient || takeFrom,
        amountIn: order.sellAmount.toString(),
        slippage: slippagePercentage, // 0 to 100
      }

      const queryString = qs.stringify(queryParams)

      const spectraMarket =
        tokenIn?.metadata?.spectraPool || tokenOut?.metadata?.spectraPool

      url = `${getUrl(chainId)}/pools/${spectraMarket}/swap?${queryString}`
    }

    const response = await fetchService.fetch(url, {
      timeout,
    })

    if (!response.ok) {
      const msg =
        (await response.text()) || `Failed with status ${response.status}`

      log({ name: "[SPECTRA ERROR]", msg, recipient, url })
      failed(SPECTRA_METADATA, chainId, sellToken, buyToken, msg)
    }

    const {
      amountOut: dstAmount,
      router: to,
      calldata: data,
    } = await response.json()

    return { dstAmount, to, data }
  }

  private async isExpiredMarket(
    fetchService: IFetchService,
    chainId: number,
    token: TokenListItem,
    timeout?: string,
  ) {
    if (
      !this.expiredPoolsCache[chainId] ||
      this.expiredPoolsCache[chainId].lastUpdated !== todayUTC()
    ) {
      this.expiredPoolsCache[chainId] = {
        pools: [],
        lastUpdated: -1,
      }

      const url = `${getUrl(chainId)}/pools`
      const response = await fetchService.fetch(url, {
        timeout: timeout as any,
      })

      if (response.ok) {
        const allPools = await response.json()

        this.expiredPoolsCache[chainId] = {
          pools: allPools
            .filter((p: any) => p.maturity < (Date.now() / 1000).toFixed(0))
            .map((p: any) => p.address),
          lastUpdated: todayUTC(),
        }
      }
    }

    return !!this.expiredPoolsCache[chainId].pools.find((p) =>
      isAddressEqual(p as Address, token.metadata?.spectraPool as Address),
    )
  }

  isConfigAndContextValidForQuoting(
    config: Partial<SpectraConfig> | undefined,
  ): config is SpectraConfig {
    return true
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<SpectraConfig> | undefined,
  ): config is SpectraConfig {
    return true
  }
}

function getUrl(chainId: number) {
  return `https://app.spectra.finance/api/v1/${SUPPORTED_CHAINS[chainId]}`
}
