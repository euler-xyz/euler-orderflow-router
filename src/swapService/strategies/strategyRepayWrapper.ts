import { maxUint256 } from "viem"
import { SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  adjustForInterest,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  encodeRepayAndDepositMulticallItem,
  matchParams,
} from "../utils"

// Wrapper which intercepts exact in/exact out swaps, runs the pipeline again directing output to swapper and adds a repay call to original receiver
export class StrategyRepayWrapper {
  static name() {
    return "repay_wrapper"
  }
  readonly match
  readonly config

  constructor(match = {}, config = {}) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return swapParams.swapperMode === SwapperMode.EXACT_IN && swapParams.isRepay
  }

  async providers(): Promise<string[]> {
    return [] // relies on providers of underlying strategies
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyRepayWrapper.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      const innerSwapParams = {
        ...swapParams,
        isRepay: false,
        receiver: swapParams.from,
      }

      const innerSwaps = await runPipeline(innerSwapParams)

      result.quotes = innerSwaps.map((innerSwap) => {
        const repayAndDepositMulticallItem = encodeRepayAndDepositMulticallItem(
          swapParams.tokenOut.address,
          swapParams.receiver,
          maxUint256 - 1n, // this will set repay amount to available balance in the swapper. If it's more than debt, the tx will revert
          swapParams.accountOut,
        )

        const multicallItems = [
          ...innerSwap.swap.multicallItems,
          repayAndDepositMulticallItem,
        ]

        const swap = buildApiResponseSwap(swapParams.from, multicallItems)

        let debtMax = swapParams.currentDebt - BigInt(innerSwap.amountOutMin)
        if (debtMax < 0n) debtMax = 0n
        debtMax = adjustForInterest(debtMax)

        const verify = buildApiResponseVerifyDebtMax(
          swapParams.chainId,
          swapParams.receiver,
          swapParams.accountOut,
          debtMax,
          swapParams.deadline,
        )

        return {
          amountIn: String(swapParams.amount),
          amountInMax: String(swapParams.amount),
          amountOut: innerSwap.amountOut,
          amountOutMin: innerSwap.amountOutMin,
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: innerSwap.route,
          swap,
          verify,
        }
      })
    } catch (error) {
      result.error = error
    }

    return result
  }
}
