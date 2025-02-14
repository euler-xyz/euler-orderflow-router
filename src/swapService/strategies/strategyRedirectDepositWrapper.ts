import { type Address, isAddressEqual, maxUint256 } from "viem"
import { getRoutingConfig } from "../config"
import { SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  adjustForInterest,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  encodeDepositMulticallItem,
  encodeRepayAndDepositMulticallItem,
  encodeRepayMulticallItem,
  encodeSwapMulticallItem,
  matchParams,
} from "../utils"

const defaultConfig: {
  supportedVaults: Array<{
    chainId: number
    vault: Address
    asset: Address
    assetDustEVault: Address
  }>
} = {
  supportedVaults: [
    {
      chainId: 1,
      vault: "0xd001f0a15D272542687b2677BA627f48A4333b5d",
      asset: "0x73A15FeD60Bf67631dC6cd7Bc5B6e8da8190aCF5",
      assetDustEVault: "0xdEd27A6da244a5f3Ff74525A2cfaD4ed9E5B0957",
    },
  ],
}

// Wrapper which redirects deposit of over-swapped repay to vault other than the debt vault
export class StrategyRedirectDepositWrapper {
  static name() {
    return "redirect_deposit_wrapper"
  }
  readonly match
  readonly config

  constructor(match = {}, config = defaultConfig) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return (
      swapParams.swapperMode === SwapperMode.TARGET_DEBT &&
      this.config.supportedVaults.some(
        (v) =>
          v.chainId === swapParams.chainId &&
          isAddressEqual(v.vault, swapParams.receiver),
      )
    )
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyRedirectDepositWrapper.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      const vaultData = this.getSupportedVault(swapParams.receiver)
      // remove itself from the routing and run the pipeline, directing output to Swapper
      const routing = getRoutingConfig(swapParams.chainId).filter(
        (r) => r.strategy !== StrategyRedirectDepositWrapper.name(),
      )

      const innerSwapParams = {
        ...swapParams,
        receiver: swapParams.from,
        routingOverride: routing,
      }

      const innerSwap = await runPipeline(innerSwapParams)

      // split target debt repay into swap to Swapper, repay and deposit into escrow vault

      const newMulticallItems = innerSwap.swap.multicallItems.flatMap(
        (item) => {
          if (
            item.functionName === "swap" &&
            item.args[0].mode === String(SwapperMode.TARGET_DEBT)
          ) {
            const exactInSwapItemArgs = {
              ...item.args[0],
              mode: SwapperMode.EXACT_IN,
            }

            console.log("exactInSwapItemArgs: ", exactInSwapItemArgs)
            const swapItem = encodeSwapMulticallItem(exactInSwapItemArgs)
            // if target debt is 0, encode repay(max) to repay all debt, otherwise use all of the available Swapper balance
            const repayAmount =
              swapParams.targetDebt === 0n ? maxUint256 : maxUint256 - 1n
            console.log("repayAmount: ", repayAmount === maxUint256)
            const repayItem = encodeRepayMulticallItem(
              vaultData.asset,
              swapParams.receiver,
              repayAmount,
              swapParams.accountOut,
            )
            const depositItem = encodeDepositMulticallItem(
              vaultData.asset,
              vaultData.assetDustEVault,
              5n,
              swapParams.accountOut,
            )

            return [swapItem, repayItem, depositItem]
          }
          return item
        },
      )

      // reencode everything

      const swap = buildApiResponseSwap(swapParams.from, newMulticallItems)

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
      console.log("swapParams.deadline: ", swapParams.deadline)

      result.response = {
        ...innerSwap,
        swap,
        verify,
      }
    } catch (error) {
      result.error = error
    }

    return result
  }

  getSupportedVault(vault: Address) {
    const supportedVault = this.config.supportedVaults.find((v) =>
      isAddressEqual(v.vault, vault),
    )
    if (!supportedVault) throw new Error("Vault not supported")

    return supportedVault
  }
}
