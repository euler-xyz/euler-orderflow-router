import type { ChainId } from "@balmy/sdk"
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

const BERA_CHAIN_ID = 80094 as ChainId

export const OOGABOOGA_METADATA: QuoteSourceMetadata<OogaboogaSupport> = {
  name: "Ooga Booga",
  supports: {
    chains: [BERA_CHAIN_ID],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "",
}

type OogaboogaSupport = { buyOrders: false; swapAndTransfer: true }
type OogaboogaConfig = { apiKey: string }
type OogaboogaData = { tx: SourceQuoteTransaction }
export class CustomOogaboogaQuoteSource
  implements IQuoteSource<OogaboogaSupport, OogaboogaConfig, OogaboogaData>
{
  getMetadata() {
    return OOGABOOGA_METADATA
  }

  async quote(
    params: QuoteParams<OogaboogaSupport, OogaboogaConfig>,
  ): Promise<SourceQuoteResponse<OogaboogaData>> {
    const { amountOut, to, data, value } = await this.getQuote(params)

    const quote = {
      sellAmount: params.request.order.sellAmount,
      buyAmount: BigInt(amountOut),
      estimatedGas: undefined,
      allowanceTarget: calculateAllowanceTarget(params.request.sellToken, to),
      customData: {
        tx: {
          to,
          calldata: data,
          value: BigInt(value),
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
    OogaboogaConfig,
    OogaboogaData
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
    config,
  }: QuoteParams<OogaboogaSupport, OogaboogaConfig>) {
    const queryParams = {
      tokenIn: sellToken,
      tokenOut: buyToken,
      amount: order.sellAmount.toString(),
      to: recipient ?? takeFrom,
      slippage: String(slippagePercentage / 100), // 1 = 100%
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://mainnet.api.oogabooga.io/v1/swap?${queryString}`
    const response = await fetchService.fetch(url, {
      timeout,
      headers: getHeaders(config),
    })
    if (!response.ok) {
      failed(
        OOGABOOGA_METADATA,
        chainId,
        sellToken,
        buyToken,
        (await response.text()) || `Failed with status ${response.status}`,
      )
    }

    const {
      routerParams: {
        swapTokenInfo: { outputQuote: amountOut },
      },
      tx: { to, data, value },
    } = await response.json()
    return { amountOut, data, to, value }
  }

  isConfigAndContextValidForQuoting(
    config: Partial<OogaboogaConfig> | undefined,
  ): config is OogaboogaConfig {
    return !!config?.apiKey
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<OogaboogaConfig> | undefined,
  ): config is OogaboogaConfig {
    return !!config?.apiKey
  }
}

function getHeaders(config: OogaboogaConfig) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  }

  return headers
}
