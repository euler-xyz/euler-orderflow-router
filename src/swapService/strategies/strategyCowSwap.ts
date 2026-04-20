import { StatusCodes } from "http-status-codes"
import { keccak256, toHex } from "viem"
import { SwapperMode } from "../interface"
import type { StrategyResult, SwapParams } from "../types"
import {
  ApiError,
  applySlippage,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  buildApiResponseVerifySkimMin,
  matchParams,
} from "../utils"
import { fetchPreviewRedeem } from "./strategyERC4626Wrapper"

// Chains where CoW integration wrappers are deployed. Mirror of
// euler-lite/entities/cowswap/constants.ts COWSWAP_CHAIN_CONFIG.
const COW_SUPPORTED_CHAINS: Record<number, string> = {
  1: "mainnet",
}

export const COW_PROVIDER_NAME = "cow"

const COW_QUOTE_TIMEOUT_MS = 15_000
const COW_ORDER_VALID_FOR_SECONDS = 1800

// The router returns a stub swap payload for CoW quotes. The frontend never
// submits this to the Swapper — it extracts `amountIn` / `amountOutMin` and
// signs a CoW order against the EVC wrapper directly. The payload only has to
// satisfy the runner's filter (`verifierData.length >= 10`).
export class StrategyCowSwap {
  static name() {
    return "cow_swap"
  }
  readonly match
  readonly config

  constructor(match = {}, config = {}) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return swapParams.provider === COW_PROVIDER_NAME
  }

  async providers(chainId: number): Promise<string[]> {
    return COW_SUPPORTED_CHAINS[chainId] ? [COW_PROVIDER_NAME] : []
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyCowSwap.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    // Once the request targets CoW, pin the pipeline: either this strategy
    // produces a quote or the response is empty. No non-CoW fallback.
    if (!isCowCompatible(swapParams)) {
      result.quotes = []
      return result
    }

    try {
      const { sellAmount, buyAmount } = await fetchCowQuote(swapParams)

      const isExactIn = swapParams.swapperMode === SwapperMode.EXACT_IN
      // The vault-side of the CoW order is quoted in vault-share units (see
      // `fetchCowQuote`). Normalize back to the underlying asset using the
      // vault's live redeem rate so downstream consumers see `amountIn` /
      // `amountOut` in `tokenIn` / `tokenOut` units — same contract as every
      // other provider.
      //   - EXACT_IN:    buyAmount  is shares of receiver vault → underlying
      //   - TARGET_DEBT: sellAmount is shares of vaultIn vault   → underlying
      const [amountInUnderlying, amountOutUnderlying] = isExactIn
        ? [
            sellAmount,
            await fetchPreviewRedeem(
              swapParams.chainId,
              swapParams.receiver,
              buyAmount,
            ),
          ]
        : [
            await fetchPreviewRedeem(
              swapParams.chainId,
              swapParams.vaultIn,
              sellAmount,
            ),
            buyAmount,
          ]

      // For BUY orders the unknown is `sellAmount` (collateral spent) — slip up.
      // For SELL orders the unknown is `buyAmount` (output received) — slip down.
      const amountIn = amountInUnderlying
      const amountInMax = isExactIn
        ? amountInUnderlying
        : applySlippage(amountInUnderlying, swapParams.slippage, true)
      const amountOut = amountOutUnderlying
      const amountOutMin = isExactIn
        ? applySlippage(amountOutUnderlying, swapParams.slippage)
        : amountOutUnderlying

      const swap = buildApiResponseSwap(swapParams.from, [])
      const verify = isExactIn
        ? buildApiResponseVerifySkimMin(
            swapParams.chainId,
            swapParams.receiver,
            swapParams.accountOut,
            amountOutMin,
            swapParams.deadline,
          )
        : buildApiResponseVerifyDebtMax(
            swapParams.chainId,
            swapParams.receiver,
            swapParams.accountOut,
            swapParams.targetDebt,
            swapParams.deadline,
          )

      result.quotes = [
        {
          amountIn: String(amountIn),
          amountInMax: String(amountInMax),
          amountOut: String(amountOut),
          amountOutMin: String(amountOutMin),
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: [{ providerName: "CoW Swap" }],
          swap,
          verify,
        },
      ]
    } catch (error) {
      result.error = error
      // The caller explicitly asked for CoW; don't let the pipeline fall
      // through to a non-CoW strategy that would return an unusable quote.
      result.quotes = []
    }

    return result
  }
}

// Requests CoW can actually serve. Anything outside this — wrong chain,
// EXACT_OUT, EXACT_IN with isRepay (needs the Swapper repay path) — gets an
// empty-quote response instead of falling through to a non-CoW strategy.
function isCowCompatible(swapParams: SwapParams): boolean {
  if (COW_SUPPORTED_CHAINS[swapParams.chainId] === undefined) return false
  if (swapParams.swapperMode === SwapperMode.EXACT_IN)
    return !swapParams.isRepay
  return swapParams.swapperMode === SwapperMode.TARGET_DEBT
}

async function fetchCowQuote(
  swapParams: SwapParams,
): Promise<{ sellAmount: bigint; buyAmount: bigint }> {
  const chainSlug = COW_SUPPORTED_CHAINS[swapParams.chainId]
  const isExactIn = swapParams.swapperMode === SwapperMode.EXACT_IN
  const kind = isExactIn ? "sell" : "buy"

  // Mirror `cowQuoteSource` and the integration wrappers: whichever side of
  // the trade touches an ERC4626 vault uses the *vault* address as the CoW
  // token. The settlement runs withdraw/deposit inline, so this is the price
  // the order actually clears at.
  //   - EXACT_IN  (swap → deposit):         buyToken  = receiver vault
  //   - TARGET_DEBT (withdraw → swap → repay): sellToken = vaultIn vault
  // Consequence: the amount on the vault-side comes back in vault-share units,
  // not in the underlying. Downstream consumers must convert via the vault's
  // exchange rate — see euler-lite `useMultiplyForm` (amountOut) and
  // `useCollateralSwapRepay` (amountIn) for the pattern.
  const sellToken = isExactIn ? swapParams.tokenIn.address : swapParams.vaultIn
  const buyToken = isExactIn ? swapParams.receiver : swapParams.tokenOut.address

  // CoW appData expects basis points (1% = 100 bips). `swapParams.slippage` is
  // in percent. The existing `cowQuoteSource` divides by 100 here, which is
  // 10000× too small — always quotes 0 slippage. This strategy uses the
  // correct conversion.
  const slippageBips = Math.floor(swapParams.slippage * 100)
  const appData = `{"appCode":"Euler","environment":"production","metadata":{"orderClass":{"orderClass":"market"},"quote":{"slippageBips":${slippageBips},"smartSlippage":true}},"version":"1.10.0"}`
  const appDataHash = keccak256(toHex(appData))

  const body = {
    sellToken,
    buyToken,
    receiver: swapParams.origin,
    appData,
    appDataHash,
    from: swapParams.origin,
    priceQuality: "optimal",
    signingScheme: "eip712",
    validFor: COW_ORDER_VALID_FOR_SECONDS,
    kind,
    ...(isExactIn
      ? { sellAmountBeforeFee: swapParams.amount.toString() }
      : { buyAmountAfterFee: swapParams.amount.toString() }),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), COW_QUOTE_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`https://api.cow.fi/${chainSlug}/api/v1/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new ApiError(
      StatusCodes.BAD_GATEWAY,
      `CoW quote failed: ${response.status} ${text}`,
    )
  }

  const { quote } = (await response.json()) as {
    quote: { sellAmount: string; buyAmount: string }
  }

  return {
    sellAmount: BigInt(quote.sellAmount),
    buyAmount: BigInt(quote.buyAmount),
  }
}
