import { Addresses, Chains, calculateDeadline } from "@balmy/sdk"
import type {
  BuildTxParams,
  IQuoteSource,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import { failed } from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import {
  type Address,
  type Hex,
  decodeFunctionData,
  isAddress,
  isAddressEqual,
  parseAbi,
} from "viem"

const CLEAVE_QUOTE_URL = "https://api.cleave.fi/partner/v1/quote"
const DEFAULT_TX_VALID_FOR = "3h"
const SWAP_ABI = parseAbi([
  "function swapWithBlob((address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient, address referrer, uint16 referralFeeBps, bool wethAsErc20) params, bytes blob)",
])

const CLEAVE_METADATA: QuoteSourceMetadata<CleaveSupport> = {
  name: "Cleave",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.POLYGON.chainId,
      Chains.BASE.chainId,
      Chains.ARBITRUM.chainId,
    ],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "",
}
type CleaveSupport = { buyOrders: false; swapAndTransfer: true }
type CleaveConfig = { apiKey: string }
type CleaveData = { tx: SourceQuoteTransaction }
type CleaveTx = { to: Address; data: Hex; value: string }
type CleaveQuoteResponse = {
  status: string
  amountOutNet?: string
  minOut?: string | null
  partial?: { refusedAtSource?: string } | null
  remainders?: unknown[]
  preferredExecution?: string | null
  execution?: { approval?: { spender?: Address } | null } | null
  tx?: CleaveTx | null
}
type Expected = {
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  recipient: Address
  deadline: bigint
  minOut: bigint
}

export class CustomCleaveQuoteSource
  implements IQuoteSource<CleaveSupport, CleaveConfig, CleaveData>
{
  getMetadata() {
    return CLEAVE_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout, txValidFor },
    },
    config,
  }: QuoteParams<CleaveSupport, CleaveConfig>): Promise<
    SourceQuoteResponse<CleaveData>
  > {
    if (
      !isAddress(sellToken, { strict: false }) ||
      !isAddress(buyToken, { strict: false }) ||
      isAddressEqual(sellToken, Addresses.NATIVE_TOKEN) ||
      isAddressEqual(buyToken, Addresses.NATIVE_TOKEN)
    ) {
      failed(
        CLEAVE_METADATA,
        chainId,
        sellToken,
        buyToken,
        "Only ERC-20 tokens are supported",
      )
    }
    const to = (recipient ?? takeFrom) as Address
    const deadline = calculateDeadline(txValidFor ?? DEFAULT_TX_VALID_FOR)!
    const params = new URLSearchParams({
      chainId: String(chainId),
      tokenIn: sellToken,
      tokenOut: buyToken,
      amountIn: order.sellAmount.toString(),
      slippageBps: String(Math.round(slippagePercentage * 100)),
      recipient: to,
      deadline: String(deadline),
    })

    const response = await fetchService.fetch(`${CLEAVE_QUOTE_URL}?${params}`, {
      timeout,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
    if (!response.ok) {
      failed(
        CLEAVE_METADATA,
        chainId,
        sellToken,
        buyToken,
        await response.text(),
      )
    }
    const quote: CleaveQuoteResponse = await response.json()
    const { tx, amountOutNet, minOut } = quote
    if (
      !tx ||
      !amountOutNet ||
      !minOut ||
      !usable(quote) ||
      !matches(tx, quote, {
        sellToken,
        buyToken,
        sellAmount: order.sellAmount,
        recipient: to,
        deadline: BigInt(deadline),
        minOut: BigInt(minOut),
      })
    ) {
      failed(
        CLEAVE_METADATA,
        chainId,
        sellToken,
        buyToken,
        `Quote not executable for the full amount (status: ${quote.status})`,
      )
    }

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount: BigInt(amountOutNet),
      minBuyAmount: BigInt(minOut),
      type: "sell",
      allowanceTarget: tx.to,
      customData: {
        tx: { to: tx.to, calldata: tx.data, value: 0n },
      },
    }
  }

  async buildTx({
    request,
  }: BuildTxParams<CleaveConfig, CleaveData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }

  isConfigAndContextValidForQuoting(
    config: Partial<CleaveConfig> | undefined,
  ): config is CleaveConfig {
    return !!config?.apiKey
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<CleaveConfig> | undefined,
  ): config is CleaveConfig {
    return true
  }
}

function usable({
  status,
  partial,
  remainders,
  preferredExecution,
}: CleaveQuoteResponse) {
  return (
    status === "ok" &&
    preferredExecution !== "measured" &&
    partial?.refusedAtSource === "0" &&
    Array.isArray(remainders) &&
    remainders.length === 0
  )
}

function matches(tx: CleaveTx, quote: CleaveQuoteResponse, e: Expected) {
  const spender = quote.execution?.approval?.spender
  if (!spender || tx.value !== "0") return false
  try {
    const {
      functionName,
      args: [p],
    } = decodeFunctionData({ abi: SWAP_ABI, data: tx.data })
    return (
      functionName === "swapWithBlob" &&
      isAddressEqual(spender, tx.to) &&
      isAddressEqual(p.tokenIn, e.sellToken) &&
      isAddressEqual(p.tokenOut, e.buyToken) &&
      p.amountIn === e.sellAmount &&
      isAddressEqual(p.recipient, e.recipient) &&
      p.deadline === e.deadline &&
      p.minAmountOut === e.minOut &&
      p.wethAsErc20
    )
  } catch {
    return false
  }
}
