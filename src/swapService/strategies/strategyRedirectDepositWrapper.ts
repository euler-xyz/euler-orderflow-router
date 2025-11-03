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
  encodeRepayMulticallItem,
  encodeSwapMulticallItem,
  matchParams,
} from "../utils"
import { StrategyCombinedUniswap } from "./strategyCombinedUniswap"

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
      assetDustEVault: "0xB0465546E8D70E667d4a187F66eF959B1522cc77",
    },
    {
      chainId: 1,
      vault: "0x8aFF4fe319c30475D27eC623D7d44bD5eCFe9616",
      asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      assetDustEVault: "0xB93d4928f39fBcd6C89a7DFbF0A867E6344561bE",
    },
    {
      chainId: 1,
      vault: "0xFa827C231062FA549143dF3C1b3584a016642630",
      asset: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      assetDustEVault: "0x2343b4bCB96EC35D8653Fb154461fc673CB20a7e",
    },
    {
      chainId: 9745,
      vault: "0x3799251bD81925cfcCF2992F10Af27A4e62Bf3F7",
      asset: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
      assetDustEVault: "0x9F562699511351bA3d0cf3d0DF1502e776517ef3",
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
        (r) =>
          r.strategy !== StrategyRedirectDepositWrapper.name() &&
          r.strategy !== StrategyCombinedUniswap.name(), // assuming the exact out didn't work, and this is a fallback
      )

      const innerSwapParams = {
        ...swapParams,
        // receiver: swapParams.from,
        routingOverride: routing,
      }

      const innerSwaps = await runPipeline(innerSwapParams)

      // split target debt repay into swap to Swapper, repay and deposit into escrow vault
      result.quotes = innerSwaps.map((innerSwap) => {
        // const newMulticallItems = innerSwap.swap.multicallItems.flatMap(
        //   (item) => {
        //     if (
        //       item.functionName === "swap" &&
        //       item.args[0].mode === String(SwapperMode.TARGET_DEBT)
        //     ) {
        //       const exactInSwapItemArgs = {
        //         ...item.args[0],
        //         receiver: swapParams.receiver,
        //         mode: SwapperMode.EXACT_IN,
        //       }

        //       const swapItem = encodeSwapMulticallItem(exactInSwapItemArgs)
        //       // if target debt is 0, encode repay(max) to repay all debt, otherwise use all of the available Swapper balance
        //       const repayAmount =
        //         swapParams.targetDebt === 0n ? maxUint256 : maxUint256 - 1n

        //       const repayItem = encodeRepayMulticallItem(
        //         vaultData.asset,
        //         swapParams.receiver,
        //         repayAmount,
        //         swapParams.accountOut,
        //       )
        //       console.log('swapParams.receiver: ', swapParams.receiver);
        //       const depositItem = encodeDepositMulticallItem(
        //         vaultData.asset,
        //         vaultData.assetDustEVault,
        //         5n,
        //         swapParams.accountOut,
        //       )

        //       console.log('repayItem: ', repayItem);
        //       return [swapItem, repayItem, depositItem]
        //     }
        //     return item
        //   },
        // )

        const newMulticallItems = innerSwap.swap.multicallItems.map((item) => {
          // Redirect deposits to receiver (debt vault) to designated vault
          if (
            item.functionName === "deposit" &&
            item.args[1] === swapParams.receiver
          ) {
            item.args[1] = vaultData.assetDustEVault
            item = encodeDepositMulticallItem(
              item.args[0],
              vaultData.assetDustEVault,
              5n,
              swapParams.accountOut,
            )
          }

          return item
        })

        // reencode everything

        const swap = buildApiResponseSwap(swapParams.from, newMulticallItems)

        let debtMax
        if (swapParams.swapperMode === SwapperMode.TARGET_DEBT) {
          debtMax = swapParams.targetDebt || 0n
        } else {
          debtMax =
            (swapParams.currentDebt || 0n) - BigInt(innerSwap.amountOutMin)
          if (debtMax < 0n) debtMax = 0n
          debtMax = adjustForInterest(debtMax)
        }

        const verify = buildApiResponseVerifyDebtMax(
          swapParams.chainId,
          swapParams.receiver,
          swapParams.accountOut,
          debtMax,
          swapParams.deadline,
        )

        return {
          ...innerSwap,
          swap,
          verify,
        }
      })
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
