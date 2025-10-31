import { RPC_URLS } from "@/common/utils/viemClients"
import { Protocol } from "@uniswap/router-sdk"
import {
  type ChainId,
  CurrencyAmount,
  Percent,
  Token,
  TradeType,
} from "@uniswap/sdk-core"
import {
  AlphaRouter,
  type SwapOptionsSwapRouter02,
  type SwapRoute,
  SwapType,
} from "@uniswap/smart-order-router"
import { Route, encodeRouteToPath } from "@uniswap/v3-sdk"
import { ethers } from "ethers"
import { type Hex, encodeAbiParameters, parseUnits } from "viem"
import { SWAP_DEFAULT_DEADLINE } from "../config/constants"
import { SwapperMode } from "../interface"
import type { SwapParams, SwapQuote } from "../types"

export async function fetchUniswapQuote(
  swapParams: SwapParams,
): Promise<SwapQuote> {
  const rpcUrl = RPC_URLS[swapParams.chainId]
  const provider = new ethers.providers.JsonRpcProvider({
    skipFetchSetup: true,
    url: rpcUrl || "",
  })

  const router = new AlphaRouter({
    chainId: swapParams.chainId,
    provider: provider,
  })

  const baseCurrency = new Token(
    swapParams.chainId,
    swapParams.tokenOut.address,
    swapParams.tokenOut.decimals,
    swapParams.tokenOut.symbol,
    swapParams.tokenOut.name,
  )

  const quoteCurrency = new Token(
    swapParams.chainId,
    swapParams.tokenIn.address,
    swapParams.tokenIn.decimals,
    swapParams.tokenIn.symbol,
    swapParams.tokenIn.name,
  )

  const baseAmount = CurrencyAmount.fromRawAmount(
    baseCurrency,
    String(swapParams.amount),
  )

  const options: SwapOptionsSwapRouter02 = {
    recipient: swapParams.receiver,
    slippageTolerance: new Percent((swapParams.slippage || 0.1) * 100, 10_000),
    deadline: Math.floor(Date.now() / 1000 + Number(SWAP_DEFAULT_DEADLINE)),
    type: SwapType.SWAP_ROUTER_02,
  }

  // TODO auto slippage?
  const tradeType =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? TradeType.EXACT_INPUT
      : TradeType.EXACT_OUTPUT

  try {
    const route: SwapRoute | null = await router.route(
      baseAmount,
      quoteCurrency,
      tradeType,
      options,
      {
        protocols: [Protocol.V2, Protocol.V3],
      },
    )

    if (!route) throw new Error("no uniswap route found")

    const quoteAmountField =
      tradeType === TradeType.EXACT_INPUT ? "outputAmount" : "inputAmount"
    const quoteAmount = route.trade[quoteAmountField].toFixed()

    const data = {
      estimatedGasUsed: route.estimatedGasUsed.toString(),
      executionPrice: route.trade.executionPrice.toFixed(),
      gasPrice: route.gasPriceWei.toString(),
      protocol: route.trade.routes[0].protocol,
      path:
        route.trade.routes[0].protocol === "V3"
          ? encodeRouteToPath(
              new Route(
                (route.trade.routes[0] as any).pools,
                route.trade.routes[0].input,
                route.trade.routes[0].output,
              ),
              tradeType === TradeType.EXACT_OUTPUT,
            )
          : encodeAbiParameters(
              [{ type: "address[]" }],
              [route.trade.routes[0].path.map((t) => t.wrapped.address as Hex)],
            ),
      // quoteRequest: route?.methodParameters?.data,
      priceImpact: route.trade.priceImpact.toFixed(6),
      quoteAmount,
    }
    const [amountIn, amountOut] =
      tradeType === TradeType.EXACT_INPUT
        ? [
            swapParams.amount,
            parseUnits(quoteAmount, swapParams.tokenOut.decimals),
          ]
        : [
            parseUnits(quoteAmount, swapParams.tokenIn.decimals),
            swapParams.amount,
          ]

    return {
      swapParams,
      amountIn,
      amountOut,
      data: data.path as Hex,
      protocol: data.protocol,
    }
  } catch (e) {
    if (e instanceof RangeError) {
      throw new Error("no uniswap route found")
    }
    throw e
  }
}
