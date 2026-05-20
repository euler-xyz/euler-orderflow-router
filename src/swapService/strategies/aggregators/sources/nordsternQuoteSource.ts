import { AlwaysValidConfigAndContextSource } from "@balmy/sdk/dist/services/quotes/quote-sources/base/always-valid-source"
import type {
  BuildTxParams,
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
import * as chains from "viem/chains"

// Supported chains verified against https://docs.nordstern.finance/en/latest/usage.html#supported-chains
// and https://api.nordstern.finance/chains for the chains currently used by this router.
const SUPPORTED_CHAINS = [
  chains.mainnet.id,
  chains.base.id,
  chains.avalanche.id,
  chains.bsc.id,
  chains.arbitrum.id,
  chains.linea.id,
  chains.sonic.id,
  chains.hyperEvm.id,
  chains.swellchain.id,
  chains.unichain.id,
  chains.berachain.id,
  chains.bob.id,
  chains.plasma.id,
  chains.monad.id,
  chains.tac.id,
] as const

const NORDSTERN_METADATA: QuoteSourceMetadata<NordsternSupport> = {
  name: "Nordstern",
  supports: {
    chains: [...SUPPORTED_CHAINS],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "",
}

type NordsternSupport = { buyOrders: false; swapAndTransfer: true }
type NordsternConfig = Record<string, never>
type NordsternData = { tx: SourceQuoteTransaction }

type NordsternResponse = {
  toAmount: string
  tx: {
    to: string
    data: string
    value?: string
  }
  swaps?: Array<{
    gasUnits?: number | string
  }>
}

export class CustomNordsternQuoteSource extends AlwaysValidConfigAndContextSource<
  NordsternSupport,
  NordsternConfig,
  NordsternData
> {
  getMetadata() {
    return NORDSTERN_METADATA
  }

  async quote(
    params: QuoteParams<NordsternSupport, NordsternConfig>,
  ): Promise<SourceQuoteResponse<NordsternData>> {
    const { toAmount, tx, estimatedGas } = await this.getQuote(params)

    const quote = {
      sellAmount: params.request.order.sellAmount,
      buyAmount: BigInt(toAmount),
      estimatedGas,
      allowanceTarget: calculateAllowanceTarget(
        params.request.sellToken,
        tx.to,
      ),
      customData: {
        tx: {
          to: tx.to,
          calldata: tx.data,
          value: BigInt(tx.value ?? 0),
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
    NordsternConfig,
    NordsternData
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
  }: QuoteParams<NordsternSupport, NordsternConfig>) {
    const queryString = qs.stringify(
      {
        src: sellToken,
        dst: buyToken,
        amount: order.sellAmount.toString(),
        from: recipient ?? takeFrom,
        slippage: slippagePercentage / 100,
      },
      {
        skipNulls: true,
        arrayFormat: "comma",
      },
    )
    const url = `https://api.nordstern.finance/aggregator/${chainId}?${queryString}`
    const response = await fetchService.fetch(url, { timeout })

    if (!response.ok) {
      failed(
        NORDSTERN_METADATA,
        chainId,
        sellToken,
        buyToken,
        (await response.text()) || `Failed with status ${response.status}`,
      )
    }

    const quote: NordsternResponse = await response.json()
    const estimatedGas =
      quote.swaps?.reduce(
        (acc, swap) => acc + BigInt(Math.ceil(Number(swap.gasUnits ?? 0))),
        0n,
      ) ?? undefined

    return {
      toAmount: quote.toAmount,
      tx: quote.tx,
      estimatedGas,
    }
  }
}
