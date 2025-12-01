import { type Hex, parseUnits } from "viem"
import * as chains from "viem/chains"
import { SwapperMode } from "../interface"
import type { SwapApiResponse } from "../interface"
import { fetchUniswapQuote } from "../quoters"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_UNISWAP_V2,
  SWAPPER_HANDLER_UNISWAP_V3,
  applySlippage,
  binarySearchQuote,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  calculateEstimatedAmountFrom,
  encodeSwapMulticallItem,
  matchParams,
} from "../utils"

export const defaultConfig = {
  chainsSupported: [
    chains.mainnet.id,
    chains.arbitrum.id,
    chains.optimism.id,
    chains.polygon.id,
    chains.base.id,
    chains.bsc.id,
    chains.celo.id,
    chains.blast.id,
    chains.zksync.id,
    chains.zora.id,
    chains.worldchain.id,
  ] as number[],
}

export class StrategyCombinedUniswap {
  static name() {
    return "combined_uniswap"
  }
  readonly match
  readonly config

  constructor(match = {}, config = defaultConfig) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return (
      this.config.chainsSupported.includes(swapParams.chainId) &&
      swapParams.swapperMode === SwapperMode.TARGET_DEBT &&
      !swapParams.onlyFixedInputExactOut
    )
  }

  async providers(): Promise<string[]> {
    return [] // relies on providers of underlying strategies
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyCombinedUniswap.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      const swapParamsExactIn: SwapParams = {
        ...swapParams,
        swapperMode: SwapperMode.EXACT_IN,
        receiver: swapParams.from,
        isRepay: false,
      }
      const fetchQuote = async (swapParams: SwapParams) => {
        const quote = await runPipeline(swapParams)

        return {
          quote,
          amountTo: BigInt(quote[0].amountOut),
        }
      }

      const { amountTo: unitAmountTo } = await fetchQuote({
        ...swapParamsExactIn,
        amount: parseUnits("1", swapParamsExactIn.tokenIn.decimals),
      })
      if (unitAmountTo === 0n) throw new Error("quote not found")

      const estimatedAmountFrom = calculateEstimatedAmountFrom(
        unitAmountTo,
        swapParamsExactIn.amount,
        swapParamsExactIn.tokenIn.decimals,
        swapParamsExactIn.tokenOut.decimals,
      )

      // adjust target by slippage to avoid repay-too-much errors
      // slippage is given in %: 0.1 == 0.1%
      const underSwapTarget =
        (swapParamsExactIn.amount *
          BigInt(10_000 * (1 - swapParamsExactIn.slippage / 100))) /
        10_000n

      if (underSwapTarget === 0n) throw new Error("quote not found")

      const shouldContinue = (currentAmountTo: bigint) =>
        // search until quote is 99.5 - 100% target
        currentAmountTo > underSwapTarget ||
        (currentAmountTo * 1000n) / underSwapTarget < 995n

      // TODO handle case where 1 wei of input is already too much (eg swap usdc -> weth target 1e6)
      const exactInputQuotes = (await binarySearchQuote(
        swapParamsExactIn,
        fetchQuote,
        underSwapTarget,
        estimatedAmountFrom,
        shouldContinue,
      )) as SwapApiResponse[]

      result.quotes = await Promise.all(
        exactInputQuotes.map(async (exactInputQuote) => {
          const uniswapSwapParams = {
            ...swapParams,
            amount: swapParams.amount - BigInt(exactInputQuote.amountOut),
            receiver: swapParams.from,
          }

          const {
            protocol,
            data: path,
            amountIn: uniswapAmountIn, // assuming exact out trade
          } = await fetchUniswapQuote(uniswapSwapParams)

          const uniswapSwapMulticallItem = encodeSwapMulticallItem({
            handler:
              protocol === "V2"
                ? SWAPPER_HANDLER_UNISWAP_V2
                : SWAPPER_HANDLER_UNISWAP_V3,
            mode: BigInt(SwapperMode.TARGET_DEBT),
            account: swapParams.accountOut,
            tokenIn: swapParams.tokenIn.address,
            tokenOut: swapParams.tokenOut.address,
            vaultIn: swapParams.vaultIn,
            accountIn: swapParams.accountIn,
            receiver: swapParams.receiver,
            amountOut: swapParams.targetDebt,
            data: path as Hex,
          })

          const combinedMulticallItems = [
            ...exactInputQuote.swap.multicallItems,
            uniswapSwapMulticallItem,
          ]

          const swap = buildApiResponseSwap(
            swapParams.from,
            combinedMulticallItems,
          )

          const verify = buildApiResponseVerifyDebtMax(
            swapParams.chainId,
            swapParams.receiver,
            swapParams.accountOut,
            swapParams.targetDebt,
            swapParams.deadline,
          )

          const amountIn =
            BigInt(exactInputQuote.amountIn) + BigInt(uniswapAmountIn)
          const amountInMax = applySlippage(amountIn, swapParams.slippage, true)

          return {
            amountIn: String(amountIn),
            amountInMax: String(amountInMax),
            amountOut: String(swapParams.amount),
            amountOutMin: String(swapParams.amount),
            vaultIn: swapParams.vaultIn,
            receiver: swapParams.receiver,
            accountIn: swapParams.accountIn,
            accountOut: swapParams.accountOut,
            tokenIn: swapParams.tokenIn,
            tokenOut: swapParams.tokenOut,
            slippage: swapParams.slippage,
            route: [...exactInputQuote.route, { providerName: "Uniswap" }],
            swap,
            verify,
          }
        }),
      )
    } catch (error) {
      result.error = error
    }

    return result
  }
}
