import {
  type Hex,
  encodeAbiParameters,
  parseAbiParameters,
  parseUnits,
} from "viem"
import * as chains from "viem/chains"
import type { SwapParams, SwapQuote } from "../types"
import {
  adjustForInterest,
  binarySearchQuote,
  buildApiResponseExactInputFromQuote,
  calculateEstimatedAmountFrom,
} from "../utils"

const chainNames: Record<number, string> = {
  [chains.arbitrum.id]: "arbitrum",
  [chains.aurora.id]: "aurora",
  [chains.avalanche.id]: "avalanche",
  [chains.bsc.id]: "bsc",
  [chains.bitTorrent.id]: "bttc",
  [chains.cronos.id]: "cronos",
  [chains.mainnet.id]: "ethereum",
  [chains.fantom.id]: "fantom",
  [chains.polygon.id]: "polygon",
  [chains.optimism.id]: "optimism",
  [chains.linea.id]: "linea",
  [chains.base.id]: "base",
  [chains.polygonZkEvm.id]: "polygon-zkevm",
  [chains.scroll.id]: "scroll",
  [chains.blast.id]: "blast",
  [chains.mantle.id]: "mantle",
}

export async function fetchKyberswapQuote(
  swapParams: SwapParams,
  skipBuild?: boolean,
): Promise<SwapQuote> {
  const params = new URLSearchParams({
    tokenIn: swapParams.tokenIn.address,
    tokenOut: swapParams.tokenOut.address,
    amountIn: swapParams.amount.toString(),
    gasInclude: "true",
  })

  // TODO config
  const referrer = "euler"
  const chainName = chainNames[swapParams.chainId]
  const headers = { "x-client-id": referrer }

  const url = `https://aggregator-api.kyberswap.com/${chainName}/api/v1/routes?${params.toString()}`

  const quoteResponse = await fetch(url, { headers })

  if (!quoteResponse.ok) {
    throw new Error(`${quoteResponse.status} ${quoteResponse.statusText}`)
  }

  let res
  try {
    res = await quoteResponse.json()
  } catch {
    throw new Error("Error parsing response json")
  }

  if (skipBuild) {
    const amountOut = BigInt(res.data.routeSummary.amountOut)

    return {
      swapParams,
      amountIn: swapParams.amount,
      amountOut,
      data: "0x" as Hex,
      protocol: "Kyberswap",
    }
  }

  const body = {
    routeSummary: res.data.routeSummary,
    slippageTolerance: swapParams.slippage * 100,
    recipient: swapParams.receiver,
    source: referrer,
    sender: swapParams.from,
    skipSimulateTransaction: true,
  }

  const buildResponse = await fetch(
    `https://aggregator-api.kyberswap.com/${chainName}/api/v1/route/build`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  )

  if (!buildResponse.ok) {
    throw new Error(`${buildResponse.status} ${buildResponse.statusText}`)
  }
  try {
    res = await buildResponse.json()
  } catch {
    throw new Error("Error parsing response json")
  }

  const data = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    res.data.routerAddress,
    res.data.data,
  ])
  const amountOut = BigInt(res.data.amountOut)

  return {
    swapParams,
    amountIn: swapParams.amount,
    amountOut,
    data,
    protocol: "Kyberswap",
  }
}

export async function fetchKyberswapOverswapQuote(swapParams: SwapParams) {
  const fetchQuote = async (sp: SwapParams, skipBuild: boolean) => {
    const quote = await fetchKyberswapQuote(sp, skipBuild)
    return {
      quote: buildApiResponseExactInputFromQuote(sp, quote),
      amountTo: BigInt(quote.amountOut),
    }
  }

  const { amountTo: unitAmountTo } = await fetchQuote(
    {
      ...swapParams,
      amount: parseUnits("1", swapParams.tokenIn.decimals),
    },
    true,
  )

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
    (swapParams: SwapParams) => fetchQuote(swapParams, true),
    overSwapTarget,
    estimatedAmountFrom,
    shouldContinue,
  )

  const buildSwapParams: SwapParams = {
    ...swapParams,
    amount: BigInt(quote.amountIn),
  }
  const build = await fetchQuote(buildSwapParams, false)

  return build.quote
}
