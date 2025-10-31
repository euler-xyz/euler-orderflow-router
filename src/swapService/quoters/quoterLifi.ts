import { encodeAbiParameters, parseAbiParameters } from "viem"
import type { SwapParams, SwapQuote } from "../types"
import { getSwapper } from "../utils"

const chainKeys: Record<number, string> = {
  1: "eth",
  10: "opt",
  30: "rsk",
  56: "bsc",
  100: "dai",
  122: "fus",
  137: "pol",
  250: "ftm",
  252: "fra",
  288: "bob",
  324: "era",
  1088: "mam",
  1101: "pze",
  1284: "moo",
  1285: "mor",
  1329: "sei",
  1625: "gra",
  5000: "mnt",
  8453: "bas",
  13371: "imx",
  34443: "mod",
  42161: "arb",
  42220: "cel",
  43114: "ava",
  59144: "lna",
  81457: "bls",
  167000: "tai",
  534352: "scl",
  1313161554: "aur",
}

const PROTOCOL_NAME = "LI.FI"

export async function fetchLiFiExactInQuote(
  swapParams: SwapParams,
): Promise<SwapQuote> {
  const chainKey = chainKeys[swapParams.chainId]

  const params = new URLSearchParams({
    fromChain: chainKey,
    toChain: chainKey,
    fromToken: swapParams.tokenIn.address,
    toToken: swapParams.tokenOut.address,
    fromAddress: swapParams.from || getSwapper(swapParams.chainId),
    toAddress: swapParams.receiver,
    fromAmount: String(swapParams.amount),
    slippage: String(swapParams.slippage / 100), // 1 = 100%
    integrator: "euler", // TODO - config
  })

  const url = `https://li.quest/v1/quote?${params.toString()}`
  const requestHeaders = new Headers()
  if (process.env.LIFI_API_KEY)
    requestHeaders.set("x-lifi-api-key", process.env.LIFI_API_KEY)
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
    res.transactionRequest.to,
    res.transactionRequest.data,
  ])

  const amountIn = BigInt(res.estimate.fromAmount)
  const amountOut = BigInt(res.estimate.toAmount)
  return {
    swapParams,
    amountIn,
    amountOut,
    data,
    protocol: PROTOCOL_NAME,
  }
}

export async function fetchLiFiExactOutQuote(
  swapParams: SwapParams,
): Promise<SwapQuote> {
  const chainKey = chainKeys[swapParams.chainId]

  const params = new URLSearchParams({
    fromChain: chainKey,
    toChain: chainKey,
    fromToken: swapParams.tokenIn.address,
    toToken: swapParams.tokenOut.address,
    fromAddress: swapParams.from,
    toAddress: swapParams.receiver,
    toAmount: String(swapParams.amount),
    slippage: String(swapParams.slippage / 100), // 1 = 100%
    integrator: "euler",
  })

  const url = `https://li.quest/v1/quote/toAmount?${params.toString()}`
  const requestHeaders = new Headers()
  if (process.env.LIFI_API_KEY)
    requestHeaders.set("x-lifi-api-key", process.env.LIFI_API_KEY)
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
    res.transactionRequest.to,
    res.transactionRequest.data,
  ])

  const amountIn = BigInt(res.action.fromAmount)
  const amountOut = BigInt(res.estimate.toAmount)
  const amountOutMin = BigInt(res.estimate.toAmountMin)
  return {
    swapParams,
    amountIn,
    amountOut,
    amountOutMin,
    data,
    protocol: PROTOCOL_NAME,
  }
}
