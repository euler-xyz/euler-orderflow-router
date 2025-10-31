// import * as chains from "viem/chains"
// import { SwapperMode } from "../interface"
// import { fetchLiFiExactInQuote, fetchLiFiExactOutQuote } from "../quoters"
// import type { StrategyResult, SwapParams } from "../types"
// import {
//   SWAPPER_HANDLER_GENERIC,
//   buildApiResponseExactInputFromQuote,
//   buildApiResponseSwap,
//   buildApiResponseVerifyDebtMax,
//   encodeSwapMulticallItem,
//   isExactInRepay,
//   matchParams,
//   quoteToRoute,
// } from "../utils"

// export const defaultConfig = {
//   chainsSupported: [
//     chains.mainnet.id,
//     chains.bsc.id,
//     chains.arbitrum.id,
//     chains.base.id,
//     chains.blast.id,
//     chains.avalanche.id,
//     chains.polygon.id,
//     chains.scroll.id,
//     chains.optimism.id,
//     chains.linea.id,
//     chains.zksync.id,
//     chains.polygonZkEvm.id,
//     chains.gnosis.id,
//     chains.fantom.id,
//     chains.moonriver.id,
//     chains.fuse.id,
//     chains.boba.id,
//     chains.mode.id,
//     chains.metis.id,
//     chains.aurora.id,
//     chains.sei.id,
//     chains.immutableZkEvm.id,
//     chains.gravity.id,
//     chains.taiko.id,
//     chains.fraxtal.id,
//     chains.rootstock.id,
//     chains.celo.id,
//     chains.mantle.id,
//   ] as number[],
// }

// export class StrategyLifi {
//   static name() {
//     return "lifi"
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
//       this.config.chainsSupported.includes(swapParams.chainId)
//     )
//   }

//   async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
//     const result: StrategyResult = {
//       strategy: StrategyLifi.name(),
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
//     const quote = await fetchLiFiExactInQuote(swapParams)

//     return buildApiResponseExactInputFromQuote(swapParams, quote)
//   }

//   async targetDebt(swapParams: SwapParams) {
//     const innerSwapParams = {
//       ...swapParams,
//       receiver: swapParams.from,
//     }
//     const quote = await fetchLiFiExactOutQuote(innerSwapParams)

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
//         data: quote.data,
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
//       amountIn: String(quote.amountIn),
//       amountInMax: String(quote.amountIn),
//       amountOut: String(quote.amountOut),
//       amountOutMin: String(quote.amountOut), // slippage is included in lifi estimations. It will be in the overswapped amount
//       vaultIn: swapParams.vaultIn,
//       receiver: swapParams.receiver,
//       accountIn: swapParams.accountIn,
//       accountOut: swapParams.accountOut,
//       tokenIn: swapParams.tokenIn,
//       tokenOut: swapParams.tokenOut,
//       slippage: swapParams.slippage,
//       route: quoteToRoute(quote),
//       swap,
//       verify,
//     }
//   }
// }
