import { Addresses, isSameAddress } from "@balmy/sdk"
import { AlwaysValidConfigAndContextSource } from "@balmy/sdk/dist/services/quotes/quote-sources/base/always-valid-source"
import type {
  BuildTxParams,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  calculateAllowanceTarget,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import * as chains from "viem/chains"

// Moose Spot Trading API: https://moose.trade/docs/#api
// OpenAPI: https://moose.trade/api/spot-openapi.json
// Exact-input swaps on Monad. No API key. Output returns to the transaction sender.
const MOOSE_QUOTE_URL = "https://api.moose.trade/v1/quote"
const SUPPORTED_CHAINS = [chains.monad.id] as const
// The API rejects slippage above 50%.
const MAX_SLIPPAGE_BPS = 5000

const MOOSE_METADATA: QuoteSourceMetadata<MooseSupport> = {
  name: "Moose",
  supports: {
    chains: [...SUPPORTED_CHAINS],
    swapAndTransfer: false,
    buyOrders: false,
  },
  logoURI: "",
}

type MooseSupport = { buyOrders: false; swapAndTransfer: false }
type MooseConfig = Record<string, never>
type MooseData = { tx: SourceQuoteTransaction }

type MooseQuoteResponse = {
  quote: {
    amountOut: string
    minAmountOut: string
  }
  transaction: {
    to: string
    data: string
    value: string
    gas: string
  }
  spender: string
}

export class CustomMooseQuoteSource extends AlwaysValidConfigAndContextSource<
  MooseSupport,
  MooseConfig,
  MooseData
> {
  getMetadata() {
    return MOOSE_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout },
    },
  }: QuoteParams<MooseSupport, MooseConfig>): Promise<
    SourceQuoteResponse<MooseData>
  > {
    const slippageBps = Math.round(slippagePercentage * 100)
    if (slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
      failed(
        MOOSE_METADATA,
        chainId,
        sellToken,
        buyToken,
        `Slippage of ${slippageBps} bps is outside 0 to ${MAX_SLIPPAGE_BPS} bps`,
      )
    }

    const response = await fetchService.fetch(MOOSE_QUOTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenIn: toMooseToken(sellToken),
        tokenOut: toMooseToken(buyToken),
        amountIn: order.sellAmount.toString(),
        slippageBps,
      }),
      timeout,
    })

    if (!response.ok) {
      failed(
        MOOSE_METADATA,
        chainId,
        sellToken,
        buyToken,
        (await response.text()) || `Failed with status ${response.status}`,
      )
    }

    const { quote, transaction, spender }: MooseQuoteResponse =
      await response.json()

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount: BigInt(quote.amountOut),
      minBuyAmount: BigInt(quote.minAmountOut),
      // A conservative gas limit for the swap, as the API returns it.
      estimatedGas: BigInt(transaction.gas),
      allowanceTarget: calculateAllowanceTarget(sellToken, spender),
      customData: {
        tx: {
          to: transaction.to,
          calldata: transaction.data,
          value: BigInt(transaction.value),
        },
      },
      type: order.type,
    }
  }

  async buildTx({
    request,
  }: BuildTxParams<MooseConfig, MooseData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

// Moose uses the zero address for native MON.
function toMooseToken(token: string) {
  return isSameAddress(token, Addresses.NATIVE_TOKEN)
    ? Addresses.ZERO_ADDRESS
    : token
}
