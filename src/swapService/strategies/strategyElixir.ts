import { viemClients } from "@/common/utils/viemClients"
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  parseAbiParameters,
  publicActions,
} from "viem"
import { type SwapApiResponse, SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_GENERIC,
  adjustForInterest,
  applySlippage,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  buildApiResponseVerifySkimMin,
  encodeDepositMulticallItem,
  encodeRepayAndSweep,
  encodeSwapMulticallItem,
  encodeTargetDebtAsExactInMulticall,
  findToken,
  isExactInRepay,
  matchParams,
} from "../utils"

const defaultConfig: {
  supportedVaults: Array<{
    chainId: number
    vault: Address
    asset: Address
    assetDustEVault: Address
    protocol: string
  }>
} = {
  supportedVaults: [
    {
      chainId: 43114,
      protocol: "sdeUSD",
      vault: "0x68088C91446c7bEa49ea7Dbd3B96Ce62B272DC96",
      asset: "0xB57B25851fE2311CC3fE511c8F10E868932e0680",
      assetDustEVault: "0x1FF92f8C033a365de2d82d390a1799AbFCaD7394",
    },
  ],
}

// Wrapper which adds an ERC4626 deposit or withdraw in front or at the back of a trade
export class StrategyElixir {
  static name() {
    return "elixir"
  }
  readonly match
  readonly config

  constructor(match = {}, config = defaultConfig) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return (
      !isExactInRepay(swapParams) &&
      this.config.supportedVaults.some(
        (v) =>
          v.chainId === swapParams.chainId &&
          (isAddressEqual(v.vault, swapParams.tokenIn.address) ||
            isAddressEqual(v.vault, swapParams.tokenOut.address)),
      )
    )
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyElixir.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (this.isSupportedVault(swapParams.tokenIn.address)) {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenIn.address,
                underlying: swapParams.tokenOut.address,
              })
            ) {
              result.quotes = [
                await this.exactInFromVaultToUnderlying(swapParams),
              ]
            } else {
              result.quotes = await this.exactInFromVaultToAny(swapParams)
            }
          } else {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenOut.address,
                underlying: swapParams.tokenIn.address,
              })
            ) {
              result.quotes =
                await this.exactInFromUnderlyingToVault(swapParams)
            } else {
              result.quotes = await this.exactInFromAnyToVault(swapParams)
            }
          }
          break
        }
        case SwapperMode.TARGET_DEBT: {
          if (this.isSupportedVault(swapParams.tokenIn.address)) {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenIn.address,
                underlying: swapParams.tokenOut.address,
              })
            ) {
              result.quotes =
                await this.targetDebtFromVaultToUnderlying(swapParams)
            } else {
              result.quotes = await this.targetDebtFromVaultToAny(swapParams)
            }
          } else {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenOut.address,
                underlying: swapParams.tokenIn.address,
              })
            ) {
              result.quotes =
                await this.targetDebtFromUnderlyingToVault(swapParams)
            } else {
              result.quotes = await this.targetDebtFromAnyToVault(swapParams)
            }
          }
          break
        }
        // case SwapperMode.EXACT_OUT:
        default: {
          result.error = "Unsupported swap mode"
        }
      }
    } catch (error) {
      result.error = error
    }

    return result
  }

  async exactInFromVaultToUnderlying(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse> {
    const {
      swapMulticallItem: redeemMulticallItem,
      amountOut: redeemAmountOut,
    } = await encodeRedeem(
      swapParams,
      swapParams.tokenIn.address,
      swapParams.amount,
      swapParams.receiver,
    )

    const multicallItems = [redeemMulticallItem]
    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const verify = buildApiResponseVerifySkimMin(
      swapParams.chainId,
      swapParams.receiver,
      swapParams.accountOut,
      redeemAmountOut,
      swapParams.deadline,
    )

    return {
      amountIn: String(swapParams.amount),
      amountInMax: String(swapParams.amount),
      amountOut: String(redeemAmountOut),
      amountOutMin: String(redeemAmountOut),
      vaultIn: swapParams.vaultIn,
      receiver: swapParams.receiver,
      accountIn: swapParams.accountIn,
      accountOut: swapParams.accountOut,
      tokenIn: swapParams.tokenIn,
      tokenOut: swapParams.tokenOut,
      slippage: 0,
      route: [
        {
          providerName: this.getSupportedVault(swapParams.tokenIn.address)
            .protocol,
        },
      ],
      swap,
      verify,
    }
  }

  async exactInFromVaultToAny(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const {
      swapMulticallItems: redeemMulticallItems,
      amountOut: redeemAmountOut,
    } = await encodeUnstakeShares(
      swapParams,
      swapParams.tokenIn.address,
      swapParams.amount,
      swapParams.from,
    )

    const vaultData = this.getSupportedVault(swapParams.tokenIn.address)
    const tokenIn = findToken(swapParams.chainId, vaultData.asset)

    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      amount: redeemAmountOut,
    }

    const innerSwaps = await runPipeline(innerSwapParams)

    return innerSwaps.map((innerSwap) => {
      const intermediateDustDepositMulticallItem = encodeDepositMulticallItem(
        vaultData.asset,
        vaultData.assetDustEVault,
        5n, // avoid zero shares
        swapParams.dustAccount,
      )

      const multicallItems = [
        ...redeemMulticallItems,
        ...innerSwap.swap.multicallItems,
        intermediateDustDepositMulticallItem,
      ]

      const swap = buildApiResponseSwap(swapParams.from, multicallItems)
      const verify = innerSwap.verify

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
        route: [{ providerName: vaultData.protocol }, ...innerSwap.route],
        swap,
        verify,
      }
    })
  }

  async exactInFromUnderlyingToVault(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const vaultData = this.getSupportedVault(swapParams.tokenOut.address)

    const amountOut = await fetchPreviewDeposit(
      swapParams.chainId,
      vaultData.vault,
      swapParams.amount,
    )
    const swapperDepositMulticallItem = encodeDepositMulticallItem(
      vaultData.asset,
      vaultData.vault,
      0n,
      swapParams.receiver,
    )

    const multicallItems = [swapperDepositMulticallItem]

    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const amountOutMin = applySlippage(amountOut, swapParams.slippage) // vault (tokenOut) can have growing exchange rate
    const verify = buildApiResponseVerifySkimMin(
      swapParams.chainId,
      swapParams.receiver,
      swapParams.accountOut,
      amountOutMin,
      swapParams.deadline,
    )

    return [
      {
        amountIn: String(swapParams.amount),
        amountInMax: String(swapParams.amount),
        amountOut: String(amountOut),
        amountOutMin: String(amountOutMin),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: [{ providerName: vaultData.protocol }],
        swap,
        verify,
      },
    ]
  }

  async exactInFromAnyToVault(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const vaultData = this.getSupportedVault(swapParams.tokenOut.address)
    const tokenOut = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenOut) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenOut,
      receiver: swapParams.from,
    }

    const innerSwaps = await runPipeline(innerSwapParams)
    return await Promise.all(
      innerSwaps.map(async (innerSwap) => {
        const amountOut = await fetchPreviewDeposit(
          swapParams.chainId,
          vaultData.vault,
          BigInt(innerSwap.amountOut),
        )
        const amountOutMin = await fetchPreviewDeposit(
          swapParams.chainId,
          vaultData.vault,
          BigInt(innerSwap.amountOutMin),
        )

        // Swapper.deposit will deposit all of available balance into the wrapper, and move the wrapper straight to receiver, where it can be skimmed
        const swapperDepositMulticallItem = encodeDepositMulticallItem(
          vaultData.asset,
          vaultData.vault,
          0n,
          swapParams.receiver,
        )

        const multicallItems = [
          ...innerSwap.swap.multicallItems,
          swapperDepositMulticallItem,
        ]

        const swap = buildApiResponseSwap(swapParams.from, multicallItems)
        const verify = buildApiResponseVerifySkimMin(
          swapParams.chainId,
          swapParams.receiver,
          swapParams.accountOut,
          amountOutMin,
          swapParams.deadline,
        )

        return {
          amountIn: String(swapParams.amount),
          amountInMax: String(swapParams.amount),
          amountOut: String(amountOut),
          amountOutMin: String(amountOutMin),
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: [{ providerName: vaultData.protocol }, ...innerSwap.route],
          swap,
          verify,
        }
      }),
    )
  }

  async targetDebtFromVaultToUnderlying(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    // TODO expects dust - add to dust list
    const vaultData = this.getSupportedVault(swapParams.tokenIn.address)
    const withdrawAmount = adjustForInterest(swapParams.amount)

    const {
      swapMulticallItems: multicallItems,
      amountIn,
      amountOut,
    } = await encodeUnstakeAssets(
      swapParams,
      vaultData.vault,
      withdrawAmount,
      swapParams.from,
    )

    multicallItems.push(...encodeRepayAndSweep(swapParams))
    // const multicallItems = encodeTargetDebtAsExactInMulticall(
    //   swapParams,
    //   withdrawData,
    // )
    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const verify = buildApiResponseVerifyDebtMax(
      swapParams.chainId,
      swapParams.receiver,
      swapParams.accountOut,
      swapParams.targetDebt,
      swapParams.deadline,
    )

    return [
      {
        amountIn: String(amountIn), // adjusted for accruing debt
        amountInMax: String(amountIn),
        amountOut: String(amountOut),
        amountOutMin: String(amountOut),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: 0,
        route: [{ providerName: vaultData.protocol }],
        swap,
        verify,
      },
    ]
  }

  async targetDebtFromVaultToAny(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    // TODO expects dust out - add to dust list
    const vaultData = this.getSupportedVault(swapParams.tokenIn.address)
    const tokenIn = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      vaultIn: vaultData.assetDustEVault,
      accountIn: swapParams.dustAccount,
      onlyFixedInputExactOut: true, // eliminate dust in the intermediate asset (vault underlying)
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return await Promise.all(
      innerQuotes.map(async (innerQuote) => {
        const withdrawSwapParams = {
          ...swapParams,
          swapperMode: SwapperMode.EXACT_IN, // change to exact in, otherwise multicall item will be target debt and will attempt a repay
        }
        const {
          swapMulticallItems: unstakeMulticallItems,
          amountIn: withdrawAmountIn,
        } = await encodeUnstakeAssets(
          withdrawSwapParams,
          vaultData.vault,
          BigInt(innerQuote.amountIn),
          swapParams.from,
        )

        // repay or exact out will return unused input, which is the intermediate asset
        const multicallItems = [
          ...unstakeMulticallItems,
          ...innerQuote.swap.multicallItems,
        ]

        const swap = buildApiResponseSwap(swapParams.from, multicallItems)

        const verify = buildApiResponseVerifyDebtMax(
          swapParams.chainId,
          swapParams.receiver,
          swapParams.accountOut,
          swapParams.targetDebt,
          swapParams.deadline,
        )

        return {
          amountIn: String(withdrawAmountIn),
          amountInMax: String(withdrawAmountIn),
          amountOut: String(innerQuote.amountOut),
          amountOutMin: String(innerQuote.amountOutMin),
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: [{ providerName: vaultData.protocol }, ...innerQuote.route],
          swap,
          verify,
        }
      }),
    )
  }

  async targetDebtFromUnderlyingToVault(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const vaultData = this.getSupportedVault(swapParams.tokenOut.address)

    const mintAmount = adjustForInterest(swapParams.amount)

    const {
      data: mintData,
      amountIn,
      amountOut,
    } = await encodeMint(
      swapParams,
      vaultData.vault,
      mintAmount,
      swapParams.from,
    )
    const multicallItems = encodeTargetDebtAsExactInMulticall(
      swapParams,
      mintData,
    )

    // mint is encoded in target debt mode, so repay will happen automatically

    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const verify = buildApiResponseVerifyDebtMax(
      swapParams.chainId,
      swapParams.receiver,
      swapParams.accountOut,
      swapParams.targetDebt,
      swapParams.deadline,
    )

    return [
      {
        amountIn: String(amountIn),
        amountInMax: String(adjustForInterest(amountIn)), // compensate for intrinsic interest accrued in the vault (tokenIn)
        amountOut: String(amountOut),
        amountOutMin: String(amountOut),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: 0,
        route: [{ providerName: vaultData.protocol }],
        swap,
        verify,
      },
    ]
  }

  async targetDebtFromAnyToVault(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const vaultData = this.getSupportedVault(swapParams.tokenOut.address)

    const mintAmount = adjustForInterest(swapParams.amount)
    const tokenIn = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenIn) throw new Error("Inner token in not found")
    const mintSwapParams = {
      ...swapParams,
      tokenIn,
      vaultIn: vaultData.assetDustEVault,
      accountIn: swapParams.dustAccount,
      mode: SwapperMode.EXACT_IN,
    }

    const {
      data: mintData,
      amountIn: mintAmountIn,
      amountOut,
    } = await encodeMint(
      mintSwapParams,
      vaultData.vault,
      mintAmount,
      swapParams.from,
    )

    const mintMulticallItems = encodeTargetDebtAsExactInMulticall(
      mintSwapParams,
      mintData,
    )

    const tokenOut = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenOut) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      amount: mintAmountIn,
      tokenOut,
      receiver: swapParams.from,
      onlyFixedInputExactOut: true, // this option will overswap, which should cover growing exchange rate
      noRepayEncoding: true,
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return innerQuotes.map((innerQuote) => {
      const multicallItems = [
        ...innerQuote.swap.multicallItems,
        ...mintMulticallItems,
      ]

      const swap = buildApiResponseSwap(swapParams.from, multicallItems)

      const verify = buildApiResponseVerifyDebtMax(
        swapParams.chainId,
        swapParams.receiver,
        swapParams.accountOut,
        swapParams.targetDebt,
        swapParams.deadline,
      )

      return {
        amountIn: String(innerQuote.amountIn),
        amountInMax: String(innerQuote.amountInMax),
        amountOut: String(amountOut),
        amountOutMin: String(amountOut),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: [...innerQuote.route, { providerName: vaultData.protocol }],
        swap,
        verify,
      }
    })
  }

  isSupportedVault(vault: Address) {
    return this.config.supportedVaults.some((v) =>
      isAddressEqual(v.vault, vault),
    )
  }

  isSupportedVaultUnderlying({
    vault,
    underlying,
  }: { vault: Address; underlying: Address }) {
    const asset = this.config.supportedVaults.find((v) =>
      isAddressEqual(v.vault, vault),
    )?.asset
    return !!asset && isAddressEqual(asset, underlying)
  }

  getSupportedVault(vault: Address) {
    const supportedVault = this.config.supportedVaults.find((v) =>
      isAddressEqual(v.vault, vault),
    )
    if (!supportedVault) throw new Error("Vault not supported")

    return supportedVault
  }
}

export async function encodeRedeem(
  swapParams: SwapParams,
  vault: Address,
  amountIn: bigint,
  receiver: Address,
) {
  const amountOut = await fetchPreviewRedeem(
    swapParams.chainId,
    vault,
    amountIn,
  )

  const abiItem = {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    name: "redeem",
    stateMutability: "nonpayable",
    type: "function",
  }

  const redeemData = encodeFunctionData({
    abi: [abiItem],
    args: [amountIn, receiver, swapParams.from],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    vault,
    redeemData,
  ])

  const swapperAmountOut =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? 0n //ignored
      : swapParams.swapperMode === SwapperMode.EXACT_OUT
        ? amountOut
        : swapParams.targetDebt

  const swapMulticallItem = encodeSwapMulticallItem({
    handler: SWAPPER_HANDLER_GENERIC,
    mode: BigInt(swapParams.swapperMode),
    account: swapParams.accountOut,
    tokenIn: swapParams.tokenIn.address,
    tokenOut: swapParams.tokenOut.address,
    vaultIn: swapParams.vaultIn,
    accountIn: swapParams.accountIn,
    receiver: swapParams.receiver,
    amountOut: swapperAmountOut,
    data: swapData,
  })

  return {
    amountIn,
    amountOut,
    swapMulticallItem,
  }
}

export async function encodeUnstakeShares(
  swapParams: SwapParams,
  vault: Address,
  amountIn: bigint,
  receiver: Address,
) {
  const amountOut = await fetchPreviewRedeem(
    swapParams.chainId,
    vault,
    amountIn,
  )

  const abiItemCooldown = {
    inputs: [{ name: "shares", type: "uint256" }],
    name: "cooldownShares",
    stateMutability: "nonpayable",
    type: "function",
  }

  const cooldownData = encodeFunctionData({
    abi: [abiItemCooldown],
    args: [amountIn],
  })

  const cooldownSwapData = encodeAbiParameters(
    parseAbiParameters("address, bytes"),
    [vault, cooldownData],
  )

  const abiItemUnstake = {
    inputs: [{ name: "receiver", type: "address" }],
    name: "unstake",
    stateMutability: "nonpayable",
    type: "function",
  }

  const unstakeData = encodeFunctionData({
    abi: [abiItemUnstake],
    args: [receiver],
  })

  const unstakeSwapData = encodeAbiParameters(
    parseAbiParameters("address, bytes"),
    [vault, unstakeData],
  )

  const swapperAmountOut =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? 0n //ignored
      : swapParams.swapperMode === SwapperMode.EXACT_OUT
        ? amountOut
        : swapParams.targetDebt
  const swapMulticallItems = []
  swapMulticallItems.push(
    encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(swapParams.swapperMode),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.address,
      tokenOut: swapParams.tokenOut.address,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: swapperAmountOut,
      data: cooldownSwapData,
    }),
  )

  swapMulticallItems.push(
    encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(swapParams.swapperMode),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.address,
      tokenOut: swapParams.tokenOut.address,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: swapperAmountOut,
      data: unstakeSwapData,
    }),
  )

  return {
    amountIn,
    amountOut,
    swapMulticallItems,
    // data: swapData,.
  }
}

export async function encodeUnstakeAssets(
  swapParams: SwapParams,
  vault: Address,
  amountOut: bigint,
  receiver: Address,
) {
  const amountIn = await fetchPreviewWithdraw(
    swapParams.chainId,
    vault,
    amountOut,
  )

  const abiItem = {
    inputs: [{ name: "assets", type: "uint256" }],
    name: "cooldownAssets",
    stateMutability: "nonpayable",
    type: "function",
  }

  const cooldownData = encodeFunctionData({
    abi: [abiItem],
    args: [amountOut],
  })

  const cooldownSwapData = encodeAbiParameters(
    parseAbiParameters("address, bytes"),
    [vault, cooldownData],
  )

  const abiItemUnstake = {
    inputs: [{ name: "receiver", type: "address" }],
    name: "unstake",
    stateMutability: "nonpayable",
    type: "function",
  }

  const unstakeData = encodeFunctionData({
    abi: [abiItemUnstake],
    args: [receiver],
  })

  const unstakeSwapData = encodeAbiParameters(
    parseAbiParameters("address, bytes"),
    [vault, unstakeData],
  )

  const swapperAmountOut =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? 0n //ignored
      : swapParams.swapperMode === SwapperMode.EXACT_OUT
        ? amountOut
        : swapParams.targetDebt

  const swapMulticallItems = []
  swapMulticallItems.push(
    encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(swapParams.swapperMode),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.address,
      tokenOut: swapParams.tokenOut.address,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: swapperAmountOut,
      data: cooldownSwapData,
    }),
  )
  swapMulticallItems.push(
    encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(swapParams.swapperMode),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.address,
      tokenOut: swapParams.tokenOut.address,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: swapperAmountOut,
      data: unstakeSwapData,
    }),
  )

  return {
    amountIn,
    amountOut,
    swapMulticallItems,
    // data: swapData,
  }
}

// export async function encodeUnstakeAssets(
//   swapParams: SwapParams,
//   vault: Address,
//   amountOut: bigint,
//   receiver: Address,
// ) {
//   const amountIn = await fetchPreviewWithdraw(
//     swapParams.chainId,
//     vault,
//     amountOut,
//   )

//   const abiItemCooldown = {
//     inputs: [{ name: "shares", type: "uint256" }],
//     name: "cooldownAssets",
//     stateMutability: "nonpayable",
//     type: "function",
//   }

//   const cooldownData = encodeFunctionData({
//     abi: [abiItemCooldown],
//     args: [amountOut],
//   })

//   const cooldownSwapData = encodeAbiParameters(
//     parseAbiParameters("address, bytes"),
//     [vault, cooldownData],
//   )

//   const abiItemUnstake = {
//     inputs: [{ name: "receiver", type: "address" }],
//     name: "unstake",
//     stateMutability: "nonpayable",
//     type: "function",
//   }

//   const unstakeData = encodeFunctionData({
//     abi: [abiItemUnstake],
//     args: [receiver],
//   })

//   const unstakeSwapData = encodeAbiParameters(
//     parseAbiParameters("address, bytes"),
//     [vault, unstakeData],
//   )

//   const swapperAmountOut =
//     swapParams.swapperMode === SwapperMode.EXACT_IN
//       ? 0n //ignored
//       : swapParams.swapperMode === SwapperMode.EXACT_OUT
//         ? amountOut
//         : swapParams.targetDebt
//   const swapMulticallItems = []
//   swapMulticallItems.push(
//     encodeSwapMulticallItem({
//       handler: SWAPPER_HANDLER_GENERIC,
//       mode: BigInt(swapParams.swapperMode),
//       account: swapParams.accountOut,
//       tokenIn: swapParams.tokenIn.address,
//       tokenOut: swapParams.tokenOut.address,
//       vaultIn: swapParams.vaultIn,
//       accountIn: swapParams.accountIn,
//       receiver: swapParams.receiver,
//       amountOut: swapperAmountOut,
//       data: cooldownSwapData,
//     }),
//   )

//   swapMulticallItems.push(
//     encodeSwapMulticallItem({
//       handler: SWAPPER_HANDLER_GENERIC,
//       mode: BigInt(swapParams.swapperMode),
//       account: swapParams.accountOut,
//       tokenIn: swapParams.tokenIn.address,
//       tokenOut: swapParams.tokenOut.address,
//       vaultIn: swapParams.vaultIn,
//       accountIn: swapParams.accountIn,
//       receiver: swapParams.receiver,
//       amountOut: swapperAmountOut,
//       data: unstakeSwapData,
//     }),
//   )

//   return {
//     amountIn,
//     amountOut,
//     swapMulticallItems,
//     // data: swapData,.
//   }
// }

export async function encodeMint(
  swapParams: SwapParams,
  vault: Address,
  amountOut: bigint,
  receiver: Address,
) {
  const amountIn = await fetchPreviewMint(swapParams.chainId, vault, amountOut)

  const abiItem = {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    name: "mint",
    stateMutability: "nonpayable",
    type: "function",
  }

  const mintData = encodeFunctionData({
    abi: [abiItem],
    args: [amountOut, receiver],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    vault,
    mintData,
  ])

  const swapperAmountOut =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? 0n //ignored
      : swapParams.swapperMode === SwapperMode.EXACT_OUT
        ? amountOut
        : swapParams.targetDebt

  const swapMulticallItem = encodeSwapMulticallItem({
    handler: SWAPPER_HANDLER_GENERIC,
    mode: BigInt(swapParams.swapperMode),
    account: swapParams.accountOut,
    tokenIn: swapParams.tokenIn.address,
    tokenOut: swapParams.tokenOut.address,
    vaultIn: swapParams.vaultIn,
    accountIn: swapParams.accountIn,
    receiver: swapParams.receiver,
    amountOut: swapperAmountOut,
    data: swapData,
  })

  return {
    amountIn,
    amountOut,
    swapMulticallItem,
    data: swapData,
  }
}

export async function fetchPreviewRedeem(
  chainId: number,
  vault: Address,
  amount: bigint,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "previewRedeem",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: vault,
    abi: [abiItem],
    functionName: "previewRedeem",
    args: [amount],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

export async function fetchPreviewWithdraw(
  chainId: number,
  vault: Address,
  amount: bigint,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "previewWithdraw",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: vault,
    abi: [abiItem],
    functionName: "previewWithdraw",
    args: [amount],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

export async function fetchPreviewDeposit(
  chainId: number,
  vault: Address,
  amount: bigint,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "previewDeposit",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: vault,
    abi: [abiItem],
    functionName: "previewDeposit",
    args: [amount],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

export async function fetchPreviewMint(
  chainId: number,
  vault: Address,
  amount: bigint,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "previewMint",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: vault,
    abi: [abiItem],
    functionName: "previewMint",
    args: [amount],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

const getViemClient = (chainId: number) => {
  if (!viemClients[chainId])
    throw new Error(`No client found for chainId ${chainId}`)
  return viemClients[chainId].extend(publicActions)
}
