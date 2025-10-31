import { encodeAbiParameters, parseAbiParameters } from "viem"
import type { SwapParams, SwapQuote } from "../types"
import { getSwapper } from "../utils"

export async function fetch1InchQuote(
  swapParams: SwapParams,
): Promise<SwapQuote> {
  const params = new URLSearchParams({
    src: swapParams.tokenIn.address,
    dst: swapParams.tokenOut.address,
    amount: String(swapParams.amount),
    from: swapParams.from || getSwapper(swapParams.chainId),
    origin: swapParams.origin,
    slippage: String(swapParams.slippage),
    receiver: swapParams.receiver,
    disableEstimate: "true",
    includeProtocols: "true",
    excludedProtocols:
      "ONE_INCH_LIMIT_ORDER_V4,ONE_INCH_LIMIT_ORDER_V3,ONE_INCH_LIMIT_ORDER_V2,ONE_INCH_LIMIT_ORDER",
  })

  const url = `https://api.1inch.dev/swap/v6.0/${swapParams.chainId}/swap?${params.toString()}`
  const requestHeaders = new Headers()
  requestHeaders.set("Authorization", `Bearer ${process.env.ONEINCH_API_KEY}`)
  const response = await fetch(url, { headers: requestHeaders })

  if (!response.ok) {
    // Since we don't know if this swap is correct we are going to trigger INVALID_SWAP to show a nice front error
    if (response.status === 400) throw new Error("INVALID_SWAP") // TODO unify
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

  const amountOut = BigInt(res.dstAmount)

  return {
    swapParams,
    amountIn: swapParams.amount,
    amountOut,
    data,
    protocol: "1Inch",
  }
}
