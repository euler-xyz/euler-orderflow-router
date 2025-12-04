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
import qs from "qs"

// Supported networks: https://docs.1inch.io/docs/aggregation-protocol/introduction/#supported-networkschains
export const NEPTUNE_METADATA: QuoteSourceMetadata<NeptuneSupport> = {
  name: "Neptune",
  supports: {
    chains: [1923],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://QmNr5MnyZKUv7rMhMyZPbxPbtc1A1yAVAqEEgVbep1hdBx",
}
const chainNames: Record<number, string> = {
  1923: "swell",
}
type NeptuneSupport = { buyOrders: false; swapAndTransfer: true }
type NeptuneConfig = object
type NeptuneData = { tx: SourceQuoteTransaction }
export class CustomNeptuneQuoteSource
  implements IQuoteSource<NeptuneSupport, NeptuneConfig, NeptuneData>
{
  getMetadata() {
    return NEPTUNE_METADATA
  }

  async quote(
    params: QuoteParams<NeptuneSupport, NeptuneConfig>,
  ): Promise<SourceQuoteResponse<NeptuneData>> {
    const { amountOut, to, data } = await this.getQuote(params)

    const quote = {
      sellAmount: params.request.order.sellAmount,
      buyAmount: BigInt(amountOut),
      estimatedGas: undefined,
      allowanceTarget: calculateAllowanceTarget(params.request.sellToken, to),
      customData: {
        tx: {
          to,
          calldata: data,
          value: 0n,
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
    NeptuneConfig,
    NeptuneData
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
  }: QuoteParams<NeptuneSupport, NeptuneConfig>) {
    const queryParams = {
      tokenIn: sellToken,
      tokenOut: buyToken,
      amountIn: order.sellAmount.toString(),
      receiver: recipient ?? takeFrom,
      slippage: String(slippagePercentage / 100), // 1 = 100%
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://agg-api.nep.finance/v1/${chainNames[chainId]}/swap?${queryString}`
    const response = await fetchService.fetch(url, {
      timeout,
      headers: getHeaders(),
    })
    if (!response.ok) {
      failed(
        NEPTUNE_METADATA,
        chainId,
        sellToken,
        buyToken,
        (await response.text()) || `Failed with status ${response.status}`,
      )
    }

    const {
      quote: { amountOut },
      tx: { router, data },
    } = await response.json()
    return { amountOut, data, to: router }
  }

  isConfigAndContextValidForQuoting(
    config: Partial<NeptuneConfig> | undefined,
  ): config is NeptuneConfig {
    return true
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<NeptuneConfig> | undefined,
  ): config is NeptuneConfig {
    return true
  }
}

function getHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json",
  }

  return headers
}
