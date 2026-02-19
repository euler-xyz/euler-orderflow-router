import { SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  buildApiResponseVerifyTransferMin,
  matchParams,
} from "../utils"
import contractBook from "@/common/utils/contractBook"

// Wrapper which intercepts exact in swaps and redirects the output to a different receiver
export class StrategyRedirectTransferReceiver {
  static name() {
    return "redirect_transfer_receiver_wrapper"
  }
  readonly match
  readonly config

  constructor(match = {}, config = {}) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return swapParams.swapperMode === SwapperMode.EXACT_IN && !!swapParams.transferOutputToReceiver
  }

  async providers(): Promise<string[]> {
    return [] // relies on providers of underlying strategies
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyRedirectTransferReceiver.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      const innerSwapParams = {
        ...swapParams,
        receiver: contractBook.swapVerifier.address[swapParams.chainId],
        skipSweepDepositOut: true,
      }

      const innerSwaps = await runPipeline(innerSwapParams)

      result.quotes = innerSwaps.map((innerSwap) => {
        const verify = buildApiResponseVerifyTransferMin(
          swapParams.chainId,
          swapParams.tokenOut.address,
          swapParams.receiver,
          BigInt(innerSwap.amountOutMin),
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
          swap: innerSwap.swap,
          verify,
          transferOutputToReceiver: true,
        }
      })
    } catch (error) {
      result.error = error
    }

    return result
  }
}
