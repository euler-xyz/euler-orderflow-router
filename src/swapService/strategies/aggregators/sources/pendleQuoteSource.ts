import { findToken } from "@/swapService/utils"
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
import { getAddress } from "viem"
import pendleAggregators from "./pendle/pendleAggregators.json"

const soldOutCoolOff: Record<string, number> = {}

const SOLD_OUT_COOL_OFF_TIME = 60 * 60 * 1000

// https://api-v2.pendle.finance/core/docs#/Chains/ChainsController_getSupportedChainIds
export const AGGREGATOR_NAMES: Record<string, string> = {
  kyberswap: "KyberSwap",
  odos: "Odos",
  paraswap: "Velora",
  okx: "OKX",
}
type PendleSupport = { buyOrders: false; swapAndTransfer: true }
type CustomOrAPIKeyConfig =
  | { customUrl: string; apiKey?: undefined }
  | { customUrl?: undefined; apiKey: string }
type PendleConfig = CustomOrAPIKeyConfig
type PendleData = { tx: SourceQuoteTransaction; pendleAggregator: string }

export class CustomPendleQuoteSource
  implements IQuoteSource<PendleSupport, PendleConfig, PendleData>
{
  private aggregator: string

  constructor(_aggregator: string) {
    this.aggregator = _aggregator
  }
  getMetadata() {
    const metadata = {
      name: `Pendle ${AGGREGATOR_NAMES[this.aggregator] || this.aggregator}`,
      supports: {
        chains: Object.keys(pendleAggregators)
          .filter((chainId) =>
            pendleAggregators[chainId].includes(this.aggregator),
          )
          .map(Number),
        swapAndTransfer: true,
        buyOrders: false,
      },
      logoURI: "",
    } as QuoteSourceMetadata<PendleSupport>

    return metadata
  }

  async quote(
    params: QuoteParams<PendleSupport, PendleConfig>,
  ): Promise<SourceQuoteResponse<PendleData>> {
    const { dstAmount, to, data, aggregator } = await this.getQuote(params)
    const quote = {
      sellAmount: params.request.order.sellAmount,
      buyAmount: BigInt(dstAmount),
      allowanceTarget: calculateAllowanceTarget(params.request.sellToken, to),
      customData: {
        tx: {
          to,
          calldata: data,
        },
        pendleAggregator: aggregator,
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
    if (
      !tokenIn.metadata?.isPendleLP &&
      !tokenOut.metadata?.isPendleLP &&
      !tokenIn.metadata?.isPendlePT &&
      !tokenOut.metadata?.isPendlePT
    ) {
      failed(
        this.getMetadata(),
        chainId,
        sellToken,
        buyToken,
        "Not Pendle tokens",
      )
    }
    if (
      Date.now() - soldOutCoolOff[`${buyToken}${chainId}`] <
      SOLD_OUT_COOL_OFF_TIME
    ) {
      failed(
        this.getMetadata(),
        chainId,
        sellToken,
        buyToken,
        "Sold out cool off",
      )
    }
    // swap
    const queryParams: any = {
      receiver: recipient || takeFrom,
      slippage: slippagePercentage / 100, // 1 = 100%
      enableAggregator: true,
      tokensIn: sellToken,
      tokensOut: buyToken,
      amountsIn: order.sellAmount.toString(),
      aggregators: this.aggregator,
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://api-v2.pendle.finance/core/v2/sdk/${chainId}/convert?${queryString}`

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

      failed(this.getMetadata(), chainId, sellToken, buyToken, msg)
    }
    const { routes } = await response.json()

    const dstAmount = routes[0].outputs[0].amount
    const to = routes[0].tx.to
    const data = routes[0].tx.data
    const aggregator = routes[0].data.aggregatorType

    return { dstAmount, to, data, aggregator }
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

function getHeaders(config: PendleConfig) {
  const headers: Record<string, string> = {
    accept: "application/json",
  }
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`
  }
  return headers
}
