import { logDev } from "@/common/utils/logs"
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

function loadPipeline(swapParams: SwapParams) {
  let routing: ChainRoutingConfig
  if (swapParams.routingOverride) {
    routing = swapParams.routingOverride
  } else {
    routing = getRoutingConfig(swapParams.chainId)
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
    )
  })
}

export async function runPipeline(
  swapParams: SwapParams,
): Promise<SwapApiResponse[]> {
  const pipeline = loadPipeline(swapParams)

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
  if (!finalResult.quotes || finalResult.quotes.length === 0) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Swap quote not found",
      allResults,
    )
  }

  console.log({
    name: "Best quote",
    amountIn: finalResult.quotes[0].amountIn,
    amountInMax: finalResult.quotes[0].amountInMax,
    amountOut: finalResult.quotes[0].amountOut,
    amountOutMin: finalResult.quotes[0].amountOutMin,
    route: finalResult.quotes[0].route,
  })
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

  // make sure verify item includes at least a function selector
  quotes = quotes.filter(
    (q) => isHex(q.verify.verifierData) && q.verify.verifierData.length >= 10,
  )

  if (quotes.length === 0)
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Invalid quotes")

  for (const quote of quotes) {
    addInOutDeposits(swapParams, quote)
  }

  return quotes
}
