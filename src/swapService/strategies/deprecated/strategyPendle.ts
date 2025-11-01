// import * as chains from "viem/chains"
// import { SwapperMode } from "../../interface"
// import { fetchPendleOverswapQuote, fetchPendleQuote } from "../../quoters"
// import type { StrategyResult, SwapParams } from "../../types"
// import {
//   SWAPPER_HANDLER_GENERIC,
//   buildApiResponseExactInputFromQuote,
//   buildApiResponseSwap,
//   buildApiResponseVerifyDebtMax,
//   encodeSwapMulticallItem,
//   isExactInRepay,
//   matchParams,
// } from "../../utils"

// export const defaultConfig = {
//   chainsSupported: [
//     chains.mainnet.id,
//     chains.optimism.id,
//     chains.bsc.id,
//     chains.mantle.id,
//     chains.arbitrum.id,
//   ] as number[],
// }

// export class StrategyPendle {
//   static name() {
//     return "pendle"
//   }
//   readonly match
//   readonly config

//   constructor(match = {}, config = defaultConfig) {
//     this.match = match
//     this.config = config
//   }

//   async supports(swapParams: SwapParams) {
//     return (
//       !isExactInRepay(swapParams) &&
//       this.config.chainsSupported.includes(swapParams.chainId) &&
//       Boolean(
//         swapParams.tokenIn.metadata?.isPendlePT ||
//           swapParams.tokenOut.metadata?.isPendlePT,
//       )
//     )
//   }

//   async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
//     const result: StrategyResult = {
//       strategy: StrategyPendle.name(),
//       supports: await this.supports(swapParams),
//       match: matchParams(swapParams, this.match),
//     }

//     if (!result.supports || !result.match) return result

//     try {
//       switch (swapParams.swapperMode) {
//         case SwapperMode.EXACT_IN: {
//           result.response = await this.exactIn(swapParams)
//           break
//         }
//         case SwapperMode.TARGET_DEBT: {
//           result.response = await this.targetDebt(swapParams)
//           break
//         }
//         // case SwapperMode.EXACT_OUT:
//         default: {
//           result.error = "Unsupported swap mode"
//         }
//       }
//     } catch (error) {
//       result.error = error
//     }

//     return result
//   }

//   async exactIn(swapParams: SwapParams) {
//     const quote = await fetchPendleQuote(swapParams)

//     return buildApiResponseExactInputFromQuote(swapParams, quote)
//   }

//   async targetDebt(swapParams: SwapParams) {
//     // into the swapper
//     const innerSwapParams = {
//       ...swapParams,
//       receiver: swapParams.from,
//     }
//     const innerSwap = await fetchPendleOverswapQuote(innerSwapParams)

//     const multicallItems = [
//       encodeSwapMulticallItem({
//         handler: SWAPPER_HANDLER_GENERIC,
//         mode: BigInt(SwapperMode.TARGET_DEBT),
//         account: swapParams.accountOut,
//         tokenIn: swapParams.tokenIn.address,
//         tokenOut: swapParams.tokenOut.address,
//         vaultIn: swapParams.vaultIn,
//         accountIn: swapParams.accountIn,
//         receiver: swapParams.receiver,
//         amountOut: swapParams.targetDebt,
//         data: innerSwap.swap.multicallItems[0].args[0].data, // pendle quoter returns just a single swap multicall with the original pendle payload
//       }),
//     ]

//     const swap = buildApiResponseSwap(swapParams.from, multicallItems)

//     const verify = buildApiResponseVerifyDebtMax(
//       swapParams.chainId,
//       swapParams.receiver,
//       swapParams.accountOut,
//       swapParams.targetDebt,
//       swapParams.deadline,
//     )

//     return {
//       amountIn: innerSwap.amountIn,
//       amountInMax: innerSwap.amountInMax,
//       amountOut: innerSwap.amountOut,
//       amountOutMin: innerSwap.amountOutMin,
//       vaultIn: swapParams.vaultIn,
//       receiver: swapParams.receiver,
//       accountIn: swapParams.accountIn,
//       accountOut: swapParams.accountOut,
//       tokenIn: swapParams.tokenIn,
//       tokenOut: swapParams.tokenOut,
//       slippage: swapParams.slippage,
//       route: innerSwap.route,
//       swap,
//       verify,
//     }
//   }
// }
