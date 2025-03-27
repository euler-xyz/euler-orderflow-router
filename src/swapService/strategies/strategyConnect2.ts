import { type Address, parseUnits } from "viem"
import { BINARY_SEARCH_TIMEOUT_SECONDS } from "../config/constants"
import {
  type SwapApiResponse,
  type SwapApiResponseMulticallItem,
  SwapperMode,
} from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams, SwapQuote } from "../types"
import {
  adjustForInterest,
  binarySearchQuote,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  calculateEstimatedAmountFrom,
  encodeDepositMulticallItem,
  encodeRepayAndSweep,
  findToken,
  isExactInRepay,
  matchParams,
  promiseWithTimeout,
} from "../utils"

type Connect2Config = {
  chainId: number
  connector: Address
  connectorDustVault: Address
}

// Wrapper which stitches 2 swaps together through a configured connector asset
export class StrategyConnect2 {
  static name() {
    return "connect2"
  }
  readonly match
  readonly config: Connect2Config

  constructor(match = {}, config?: Connect2Config) {
    if (!config) throw new Error("StrategyConnect2 missing config")
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return (
      !isExactInRepay(swapParams) && swapParams.chainId === this.config.chainId
    )
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyConnect2.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          result.quotes = await this.exactIn(swapParams)
          break
        }
        case SwapperMode.TARGET_DEBT: {
          result.quotes = await this.targetDebt(swapParams)
          break
        }
        default: {
          result.error = "Unsupported swap mode"
        }
      }
    } catch (error) {
      result.error = error
    }

    return result
  }

  async exactIn(swapParams: SwapParams): Promise<SwapApiResponse[]> {
    const connectorToken = findToken(swapParams.chainId, this.config.connector)
    if (!connectorToken) throw new Error("Connector token not found")

    const toConnectorSwapParams = {
      ...swapParams,
      tokenOut: connectorToken,
    }

    const toConnectorSwaps = await runPipeline(toConnectorSwapParams)

    if (toConnectorSwaps.length === 0)
      throw new Error("To connector quotes not found")

    //TODO fix for multiple results, taking the first one for now
    const toConnectorSwap = toConnectorSwaps[0]

    const fromConnectorSwapParams = {
      ...swapParams,
      tokenIn: connectorToken,
      amount: BigInt(toConnectorSwap.amountOutMin),
    }

    const fromConnectorSwaps = await runPipeline(fromConnectorSwapParams)
    if (fromConnectorSwaps.length === 0)
      throw new Error("From connector quotes not found")

    return fromConnectorSwaps.map((fromConnectorSwap) => {
      const connectorDustDepositMulticallItem = encodeDepositMulticallItem(
        this.config.connector,
        this.config.connectorDustVault,
        5n, // avoid zero shares
        swapParams.dustAccount,
      )

      const multicallItems = [
        ...toConnectorSwap.swap.multicallItems,
        ...fromConnectorSwap.swap.multicallItems,
        connectorDustDepositMulticallItem,
      ]

      const swap = buildApiResponseSwap(swapParams.from, multicallItems)
      const verify = fromConnectorSwap.verify

      return {
        amountIn: String(swapParams.amount),
        amountInMax: String(swapParams.amount),
        amountOut: fromConnectorSwap.amountOut,
        amountOutMin: fromConnectorSwap.amountOutMin,
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: [...toConnectorSwap.route, ...fromConnectorSwap.route],
        swap,
        verify,
      }
    })
  }

  async targetDebt(swapParams: SwapParams) {
    const innerSwapParams = {
      ...swapParams,
      receiver: swapParams.from,
      swapperMode: SwapperMode.EXACT_IN,
      isRepay: false,
    }

    const quotes = await this.#binarySearchOverswapQuote(innerSwapParams)

    if (!quotes) throw new Error("Quote not found")

    return quotes.map((quote: SwapApiResponse) => {
      const multicallItems: SwapApiResponseMulticallItem[] = []

      multicallItems.push(
        ...quote.swap.multicallItems,
        ...encodeRepayAndSweep(swapParams),
      )

      const swap = buildApiResponseSwap(swapParams.from, multicallItems)

      const verify = buildApiResponseVerifyDebtMax(
        swapParams.chainId,
        swapParams.receiver,
        swapParams.accountOut,
        swapParams.targetDebt,
        swapParams.deadline,
      )

      return {
        amountIn: quote.amountIn,
        amountInMax: quote.amountInMax,
        amountOut: quote.amountOut,
        amountOutMin: quote.amountOutMin,
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: quote.route,
        swap,
        verify,
      }
    })
  }

  async #binarySearchOverswapQuote(swapParams: SwapParams) {
    const swapParamsExactIn = {
      ...swapParams,
      swapperMode: SwapperMode.EXACT_IN,
      receiver: swapParams.from,
      isRepay: false,
    }

    const unitQuotes = await this.exactIn({
      ...swapParamsExactIn,
      amount: parseUnits("1", swapParams.tokenIn.decimals),
    })

    const unitAmountTo = unitQuotes[0].amountOutMin

    const estimatedAmountIn = calculateEstimatedAmountFrom(
      BigInt(unitAmountTo),
      swapParamsExactIn.amount,
      swapParamsExactIn.tokenIn.decimals,
      swapParamsExactIn.tokenOut.decimals,
    )

    if (estimatedAmountIn === 0n) throw new Error("quote not found")

    const overSwapTarget = adjustForInterest(swapParams.amount)

    const shouldContinue = (currentAmountTo: bigint): boolean =>
      // search until quote is 100 - 100.5% target
      currentAmountTo < overSwapTarget ||
      (currentAmountTo * 1000n) / overSwapTarget > 1005n

    // single run to preselect sources
    const initialQuotes = await this.exactIn({
      ...swapParams,
      amount: estimatedAmountIn,
    })

    const allSettled = await Promise.allSettled(
      initialQuotes.map(async (initialQuote) =>
        promiseWithTimeout(async () => {
          const quote = await binarySearchQuote(
            swapParams,
            async (swapParams: SwapParams) => {
              const result = await this.exactIn(swapParams)
              return {
                quote: result[0],
                amountTo: BigInt(result[0].amountOutMin),
              }
            },
            overSwapTarget,
            estimatedAmountIn,
            shouldContinue,
            {
              quote: initialQuote,
              amountTo: BigInt(initialQuote.amountOutMin),
            },
          )
          return quote
        }, BINARY_SEARCH_TIMEOUT_SECONDS),
      ),
    )

    const bestQuotes = allSettled
      .filter((q) => q.status === "fulfilled")
      .map((q) => q.value)
    if (bestQuotes.length === 0) throw new Error("Quotes not found")

    return bestQuotes
  }
}
