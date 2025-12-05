import { logProd } from "@/common/utils/logs"
import { log } from "@uniswap/smart-order-router"
import { StatusCodes } from "http-status-codes"
import { isHex } from "viem"
import { getRoutingConfig } from "./config"
import type {
  ChainRoutingConfig,
  RoutingItem,
  SwapApiResponse,
} from "./interface"
import { strategies } from "./strategies/index"
import type { StrategyResult, SwapParams } from "./types"
import { ApiError, addInOutDeposits } from "./utils"

// provider is needed in construction by balmy strategy which doesn't filter providers during the quote
function loadPipeline(
  chainId: number,
  routingOverride?: ChainRoutingConfig,
  provider?: string,
) {
  let routing: ChainRoutingConfig
  if (routingOverride) {
    routing = routingOverride
  } else {
    routing = getRoutingConfig(chainId)
    if (!routing)
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "Routing config not found for chainId",
      )
  }

  return routing.map((routingItem: RoutingItem) => {
    return new strategies[routingItem.strategy](
      routingItem.match,
      routingItem.config,
      provider,
    )
  })
}

export async function runPipeline(
  swapParams: SwapParams,
): Promise<SwapApiResponse[]> {
  const pipeline = loadPipeline(
    swapParams.chainId,
    swapParams.routingOverride,
    swapParams.provider,
  )

  const allResults: StrategyResult[] = []
  for (const strategy of pipeline) {
    const result = await strategy.findSwap(swapParams)
    allResults.push(result)
    if (result.quotes) break
  }

  console.log(allResults)

  const finalResult = allResults.at(-1)
  if (!finalResult)
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Pipeline empty or result not found",
    )

  // empty results when provider is set is a valid response
  if (
    !finalResult.quotes ||
    (finalResult.quotes.length === 0 && !swapParams.provider)
  ) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Swap quote not found",
      allResults,
    )
  }

  if (finalResult.quotes.length) {
    console.log({
      name: "Best quote",
      amountIn: finalResult.quotes[0].amountIn,
      amountInMax: finalResult.quotes[0].amountInMax,
      amountOut: finalResult.quotes[0].amountOut,
      amountOutMin: finalResult.quotes[0].amountOutMin,
      route: finalResult.quotes[0].route,
    })
  } else {
    console.log("Empty results []")
  }
  // console.log(
  //   finalResult.quotes
  //     .map((q) => q.route.map((r) => r.providerName).join(" "))
  //     .join(", "),
  // )

  // console.log('finalResult.quotes: ', JSON.stringify(finalResult.quotes, null, 2));

  return finalResult.quotes
}

export async function findSwaps(swapParams: SwapParams) {
  // GLOBAL CHECKS
  let quotes = await runPipeline(swapParams)
  const origQuoteLenght = quotes.length

  // make sure verify item includes at least a function selector
  quotes = quotes.filter(
    (q) => isHex(q.verify.verifierData) && q.verify.verifierData.length >= 10,
  )

  if (origQuoteLenght > 0 && quotes.length === 0)
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Invalid quotes")

  for (const quote of quotes) {
    addInOutDeposits(swapParams, quote)
  }

  logProd({
    name: "[QUOTES FOUND]",
    swapParams,
    quotes,
  })

  return quotes
}

export async function reflectProviders(chainId: number) {
  const pipeline = loadPipeline(chainId)

  return [
    ...new Set(
      (
        await Promise.all(
          pipeline.map((strategy) => strategy.providers(chainId)),
        )
      ).flat(),
    ),
  ]
}
