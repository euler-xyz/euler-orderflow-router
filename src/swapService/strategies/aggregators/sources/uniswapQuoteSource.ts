import { Addresses, Chains, calculateDeadline, isSameAddress } from "@balmy/sdk"
import type {
  BuildTxParams,
  IQuoteSource,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  calculateAllowanceTarget,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import { getAddress, isAddress, zeroAddress } from "viem"
import { z } from "zod"

const API_URL = "https://trade-api.gateway.uniswap.org/v1"
const UNISWAP_METADATA: QuoteSourceMetadata<UniswapSupport> = {
  name: "Uniswap",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.POLYGON.chainId,
      Chains.ARBITRUM.chainId,
      Chains.CELO.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.BASE.chainId,
      Chains.AVALANCHE.chainId,
      130, // Unichain
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: "ipfs://QmNa3YBYAYS5qSCLuXataV5XCbtxP9ZB4rHUfomRxrpRhJ",
}

type UniswapSupport = { buyOrders: true; swapAndTransfer: true }
type UniswapConfig = { apiKey: string }
type UniswapData = { tx: SourceQuoteTransaction }

const addressSchema = z.string().refine((value) => isAddress(value))
const amountSchema = z.string().regex(/^[0-9]+$/)
const quoteSchema = z.object({
  routing: z.literal("CLASSIC"),
  permitData: z.null(),
  quote: z
    .object({
      chainId: z.number(),
      swapper: addressSchema,
      tradeType: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]),
      input: z
        .object({
          token: addressSchema,
          amount: amountSchema,
          maximumAmount: amountSchema,
        })
        .passthrough(),
      output: z
        .object({
          token: addressSchema,
          recipient: addressSchema,
          amount: amountSchema,
          minimumAmount: amountSchema,
        })
        .passthrough(),
      gasUseEstimate: amountSchema.optional(),
    })
    .passthrough(),
})
const swapSchema = z.object({
  swap: z.object({
    to: addressSchema.refine((value) => !isSameAddress(value, zeroAddress)),
    from: addressSchema,
    chainId: z.number(),
    data: z.string().regex(/^0x(?:[0-9a-fA-F]{2}){4,}$/),
    value: z.string().regex(/^(?:[0-9]+|0x[0-9a-fA-F]+)$/),
  }),
})

export class CustomUniswapQuoteSource
  implements IQuoteSource<UniswapSupport, UniswapConfig, UniswapData>
{
  getMetadata() {
    return UNISWAP_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom, recipient = takeFrom },
    },
    config,
  }: QuoteParams<UniswapSupport, UniswapConfig>): Promise<
    SourceQuoteResponse<UniswapData>
  > {
    if (!this.isConfigAndContextValidForQuoting(config)) {
      throw new Error("Uniswap requires an API key")
    }
    const nativeInput = isSameAddress(sellToken, Addresses.NATIVE_TOKEN)
    if (nativeInput && order.type === "buy") {
      throw new Error("Uniswap does not support buy orders with native token")
    }
    // The Trading API sweeps unused exact-output input to the output recipient.
    // Keep refunds with the Swapper so Euler can return them to the input vault.
    if (order.type === "buy" && !isSameAddress(recipient, takeFrom)) {
      throw new Error(
        "Uniswap buy orders require the recipient to be the taker",
      )
    }
    const tokenIn = mapNativeToken(sellToken)
    const tokenOut = mapNativeToken(buyToken)
    const amount = order.type === "sell" ? order.sellAmount : order.buyAmount
    const type = order.type === "sell" ? "EXACT_INPUT" : "EXACT_OUTPUT"
    // Trading API accepts two decimal places; never loosen the caller's limit.
    const roundedSlippage = Number(slippagePercentage.toFixed(2))
    const slippageTolerance =
      roundedSlippage > slippagePercentage
        ? Number((roundedSlippage - 0.01).toFixed(2))
        : roundedSlippage
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": config.apiKey,
      "x-universal-router-version": "2.1.2",
      // Euler's Swapper approves the target directly and cannot sign Permit2 messages.
      "x-permit2-disabled": "true",
    }
    const post = async (path: "quote" | "swap", body: object) => {
      const response = await fetchService.fetch(`${API_URL}/${path}`, {
        method: "POST",
        headers,
        timeout,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        await response.text()
        failed(
          UNISWAP_METADATA,
          chainId,
          sellToken,
          buyToken,
          `Trading API /${path} returned HTTP ${response.status}`,
        )
      }
      return response.json()
    }

    const { quote } = quoteSchema.parse(
      await post("quote", {
        type,
        amount: amount.toString(),
        tokenInChainId: chainId,
        tokenOutChainId: chainId,
        tokenIn,
        tokenOut,
        swapper: getAddress(takeFrom),
        recipient: getAddress(recipient),
        slippageTolerance,
        // UniswapX orders need signatures and cannot execute in an Euler batch.
        protocols: ["V2", "V3", "V4"],
      }),
    )
    const sellAmount = BigInt(quote.input.amount)
    const buyAmount = BigInt(quote.output.amount)
    const maxSellAmount = BigInt(quote.input.maximumAmount)
    const minBuyAmount = BigInt(quote.output.minimumAmount)
    if (
      quote.chainId !== chainId ||
      quote.tradeType !== type ||
      !isSameAddress(quote.swapper, takeFrom) ||
      !isSameAddress(quote.input.token, tokenIn) ||
      !isSameAddress(quote.output.token, tokenOut) ||
      !isSameAddress(quote.output.recipient, recipient) ||
      sellAmount <= 0n ||
      buyAmount <= 0n ||
      maxSellAmount < sellAmount ||
      minBuyAmount <= 0n ||
      minBuyAmount > buyAmount ||
      (order.type === "sell"
        ? sellAmount !== amount || maxSellAmount !== amount
        : buyAmount !== amount || minBuyAmount !== amount)
    ) {
      throw new Error("Uniswap returned a quote inconsistent with the request")
    }

    // Always build with the requested lifetime. Quotes can omit swapTransaction
    // when simulation sees an unfunded Swapper; funds arrive in the Euler batch.
    const { swap } = swapSchema.parse(
      await post("swap", {
        quote,
        deadline: calculateDeadline(txValidFor ?? "3h"),
        simulateTransaction: false,
        refreshGasPrice: false,
        safetyMode: "SAFE",
      }),
    )
    const value = BigInt(swap.value)
    if (
      swap.chainId !== chainId ||
      !isSameAddress(swap.from, takeFrom) ||
      value !== (nativeInput ? sellAmount : 0n)
    ) {
      throw new Error("Uniswap returned an inconsistent swap transaction")
    }

    return {
      type: order.type,
      sellAmount,
      buyAmount,
      // Use the API's bounds, which match its calldata and rounding exactly.
      maxSellAmount,
      minBuyAmount,
      estimatedGas: quote.gasUseEstimate
        ? BigInt(quote.gasUseEstimate)
        : undefined,
      allowanceTarget: calculateAllowanceTarget(sellToken, swap.to),
      customData: {
        tx: { to: swap.to, calldata: swap.data, value },
      },
    }
  }

  async buildTx({
    request,
  }: BuildTxParams<
    UniswapConfig,
    UniswapData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }

  isConfigAndContextValidForQuoting(
    config: Partial<UniswapConfig> | undefined,
  ): config is UniswapConfig {
    return typeof config?.apiKey === "string" && config.apiKey.trim().length > 0
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<UniswapConfig> | undefined,
  ): config is UniswapConfig {
    return this.isConfigAndContextValidForQuoting(config)
  }
}

function mapNativeToken(token: string) {
  return isSameAddress(token, Addresses.NATIVE_TOKEN)
    ? zeroAddress
    : getAddress(token)
}
