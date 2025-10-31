import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem"
import type { SwapParams } from "../types"
import {
  adjustForInterest,
  binarySearchQuote,
  buildApiResponseExactInputFromQuote,
  calculateEstimatedAmountFrom,
} from "../utils"

export async function fetchPendleQuote(swapParams: SwapParams) {
  const pendleMarket =
    swapParams.tokenIn.meta?.pendleMarket ||
    swapParams.tokenOut.meta?.pendleMarket

  const params = new URLSearchParams({
    receiver: swapParams.receiver,
    slippage: String(swapParams.slippage / 100), // 1 = 100%
    enableAggregator: "true",
    tokenIn: swapParams.tokenIn.address,
    tokenOut: swapParams.tokenOut.address,
    amountIn: String(swapParams.amount),
  })

  const url = `https://api-v2.pendle.finance/core/v1/sdk/${
    swapParams.chainId
  }/markets/${pendleMarket}/swap?${params.toString()}`
  const requestHeaders = new Headers()
  requestHeaders.set("Authorization", `Bearer ${process.env.PENDLE_API_KEY}`)
  const response = await fetch(url, { headers: requestHeaders })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  let res
  try {
    res = await response.json()
  } catch {
    throw new Error("Error parsing response json")
  }

  const data = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    res.tx.to,
    res.tx.data,
  ])
  const amountOut = BigInt(res.data.amountOut)
  return {
    swapParams,
    amountIn: swapParams.amount,
    amountOut,
    data,
    protocol: "Pendle",
  }
}

export async function fetchPendleOverswapQuote(swapParams: SwapParams) {
  const fetchQuote = async (sp: SwapParams) => {
    // TODO refactor/rename
    const quote = await fetchPendleQuote(sp)
    return {
      quote: buildApiResponseExactInputFromQuote(sp, quote),
      amountTo: BigInt(quote.amountOut),
    }
  }

  const { amountTo: unitAmountTo } = await fetchQuote({
    ...swapParams,
    amount: parseUnits("1", swapParams.tokenIn.decimals),
  })

  if (unitAmountTo === 0n) throw new Error("quote not found")

  const overSwapTarget = adjustForInterest(swapParams.amount)

  const estimatedAmountFrom = calculateEstimatedAmountFrom(
    unitAmountTo,
    swapParams.amount,
    swapParams.tokenIn.decimals,
    swapParams.tokenOut.decimals,
  )

  const shouldContinue = (currentAmountTo: bigint): boolean =>
    // search until quote is 100 - 100.5% target
    currentAmountTo < overSwapTarget ||
    (currentAmountTo * 1000n) / overSwapTarget > 1005n

  const quote = await binarySearchQuote(
    swapParams,
    fetchQuote,
    overSwapTarget,
    estimatedAmountFrom,
    shouldContinue,
  )

  return quote
}
