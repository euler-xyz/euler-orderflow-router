import { RPC_URLS } from "@/common/utils/viemClients"
import { StatusCodes } from "http-status-codes"
import {
  http,
  type Address,
  createPublicClient,
  isAddressEqual,
  keccak256,
  parseAbi,
  toHex,
} from "viem"
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
import {
  fetchPreviewDeposit,
  fetchPreviewRedeem,
} from "./strategyERC4626Wrapper"

// Chains where CoW integration wrappers are deployed. Mirror of
// euler-lite/entities/cowswap/constants.ts COWSWAP_CHAIN_CONFIG.
const COW_SUPPORTED_CHAINS: Record<number, string> = {
  1: "mainnet",
}

export const COW_PROVIDER_NAME = "cow"

const COW_QUOTE_TIMEOUT_MS = 15_000
const COW_ORDER_VALID_FOR_SECONDS = 1800
const erc4626AssetAbi = parseAbi(["function asset() view returns (address)"])

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
    return isCowCompatible(swapParams)
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

    // Once the request targets CoW, pin the pipeline: either this strategy
    // produces a quote or the response is empty. No non-CoW fallback.
    if (
      swapParams.provider === COW_PROVIDER_NAME &&
      (!result.supports || !result.match)
    ) {
      result.quotes = []
      return result
    }

    if (!result.supports || !result.match) return result

    try {
      const { sellAmount, buyAmount, feeAmount, quoteId } =
        await fetchCowQuote(swapParams)

      const isExactIn = swapParams.swapperMode === SwapperMode.EXACT_IN
      const isCollateralSwap =
        swapParams.providerExtraData === COW_WRAPPER_COLLATERAL_SWAP
      // The vault-side of the CoW order is quoted in vault-share units (see
      // `fetchCowQuote`). Normalize back to the underlying asset using the
      // vault's live redeem rate so downstream consumers see `amountIn` /
      // `amountOut` in `tokenIn` / `tokenOut` units — same contract as every
      // other provider.
      //   - openPosition:    buyAmount  is shares of receiver vault -> underlying
      //   - closePosition:   sellAmount is shares of vaultIn vault   -> underlying
      //   - collateralSwap:  both sides are vault shares             -> underlying
      const [amountInUnderlying, amountOutUnderlying] = isExactIn
        ? [
          isCollateralSwap
            ? await fetchPreviewRedeem(
              swapParams.chainId,
              swapParams.vaultIn,
              sellAmount + feeAmount,
            )
            : sellAmount + feeAmount,
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
            sellAmount + feeAmount,
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
          providerData: { quoteId },
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

const COW_WRAPPER_OPEN_POSITION = "openPosition"
const COW_WRAPPER_CLOSE_POSITION = "closePosition"
const COW_WRAPPER_COLLATERAL_SWAP = "collateralSwap"

// Requests CoW can actually serve. Anything outside this -- missing wrapper,
// wrong chain, wrong mode, or EXACT_IN with isRepay (needs the Swapper repay
// path) -- gets an empty-quote response instead of falling through to a non-CoW
// strategy.
function isCowCompatible(swapParams: SwapParams): boolean {
  if (swapParams.provider !== COW_PROVIDER_NAME) return false
  if (swapParams.transferOutputToReceiver) return false
  if (COW_SUPPORTED_CHAINS[swapParams.chainId] === undefined) return false

  switch (swapParams.providerExtraData) {
    case COW_WRAPPER_OPEN_POSITION:
    case COW_WRAPPER_COLLATERAL_SWAP:
      return (
        swapParams.swapperMode === SwapperMode.EXACT_IN && !swapParams.isRepay
      )
    case COW_WRAPPER_CLOSE_POSITION:
      return swapParams.swapperMode === SwapperMode.TARGET_DEBT
    default:
      return false
  }
}

async function fetchCowQuote(swapParams: SwapParams): Promise<{
  sellAmount: bigint
  buyAmount: bigint
  feeAmount: bigint
  quoteId: string
}> {
  const chainSlug = COW_SUPPORTED_CHAINS[swapParams.chainId]
  const isExactIn = swapParams.swapperMode === SwapperMode.EXACT_IN
  const isCollateralSwap =
    swapParams.providerExtraData === COW_WRAPPER_COLLATERAL_SWAP

  if (isExactIn) {
    const receiverAsset = await fetchVaultAsset(
      swapParams.chainId,
      swapParams.receiver,
    )
    if (!isAddressEqual(receiverAsset, swapParams.tokenOut.address)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "CoW exact-in requires receiver.asset() to equal tokenOut",
      )
    }

    if (isCollateralSwap) {
      const vaultInAsset = await fetchVaultAsset(
        swapParams.chainId,
        swapParams.vaultIn,
      )
      if (!isAddressEqual(vaultInAsset, swapParams.tokenIn.address)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "CoW collateral swap requires vaultIn.asset() to equal tokenIn",
        )
      }
    }
  }

  const kind = isExactIn ? "sell" : "buy"

  // Mirror `cowQuoteSource` and the integration wrappers: whichever side of
  // the trade touches an ERC4626 vault uses the *vault* address as the CoW
  // token. The settlement runs withdraw/deposit inline, so this is the price
  // the order actually clears at.
  //   - openPosition (swap -> deposit):         buyToken  = receiver vault
  //   - closePosition (withdraw -> swap -> repay): sellToken = vaultIn vault
  //   - collateralSwap: sellToken = vaultIn vault, buyToken = receiver vault
  // Consequence: the amount on the vault-side comes back in vault-share units,
  // not in the underlying. Downstream consumers must convert via the vault's
  // exchange rate — see euler-lite `useMultiplyForm` (amountOut) and
  // `useCollateralSwapRepay` (amountIn) for the pattern.
  const sellToken =
    isExactIn && !isCollateralSwap
      ? swapParams.tokenIn.address
      : swapParams.vaultIn
  const buyToken = isExactIn ? swapParams.receiver : swapParams.tokenOut.address
  const amount = isCollateralSwap
    ? await fetchPreviewDeposit(
      swapParams.chainId,
      swapParams.vaultIn,
      swapParams.amount,
    )
    : swapParams.amount

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
      ? { sellAmountBeforeFee: amount.toString() }
      : { buyAmountAfterFee: amount.toString() }),
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
  const res = await response.json()
  const { quote, id } = res as {
    quote: { sellAmount: string; buyAmount: string; feeAmount?: string }
    id: string | number
  }

  return {
    sellAmount: BigInt(quote.sellAmount),
    buyAmount: BigInt(quote.buyAmount),
    feeAmount: BigInt(quote.feeAmount || "0"),
    quoteId: String(id),
  }
}

async function fetchVaultAsset(
  chainId: number,
  vault: Address,
): Promise<Address> {
  const rpcUrl = RPC_URLS[chainId]
  if (!rpcUrl) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Missing RPC URL for chain ${chainId}`,
    )
  }

  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 120_000 }),
  })

  try {
    return (await client.readContract({
      address: vault,
      abi: erc4626AssetAbi,
      functionName: "asset",
    })) as Address
  } catch {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "CoW exact-in requires receiver to implement ERC4626 asset()",
    )
  }
}
