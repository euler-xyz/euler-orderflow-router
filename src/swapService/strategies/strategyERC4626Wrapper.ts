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
  encodeSwapMulticallItem,
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
      chainId: 1,
      protocol: "wstUSR",
      vault: "0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055",
      asset: "0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110",
      assetDustEVault: "0x3a8992754e2ef51d8f90620d2766278af5c59b90",
    },
    {
      chainId: 1,
      protocol: "wUSDL",
      vault: "0x7751E2F4b8ae93EF6B79d86419d42FE3295A4559",
      asset: "0xbdC7c08592Ee4aa51D06C27Ee23D5087D65aDbcD",
      assetDustEVault: "0x0Fc9cdb39317354a98a1Afa6497a969ff3a6BA9C",
    },
    {
      chainId: 1,
      protocol: "ynETHX",
      vault: "0x657d9aba1dbb59e53f9f3ecaa878447dcfc96dcb",
      asset: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      assetDustEVault: "0xb3b36220fA7d12f7055dab5c9FD18E860e9a6bF8",
    },
    {
      chainId: 1,
      protocol: "ynETH",
      vault: "0x09db87A538BD693E9d08544577d5cCfAA6373A48",
      asset: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      assetDustEVault: "0xb3b36220fA7d12f7055dab5c9FD18E860e9a6bF8",
    },
    {
      chainId: 146,
      protocol: "wstkscETH",
      vault: "0xE8a41c62BB4d5863C6eadC96792cFE90A1f37C47",
      asset: "0x455d5f11Fea33A8fa9D3e285930b478B6bF85265",
      assetDustEVault: "0x57056B888527A9ca638CA06f2e194eF73a32CAFC",
    },
    {
      chainId: 146,
      protocol: "wstkscUSD",
      vault: "0x9fb76f7ce5FCeAA2C42887ff441D46095E494206",
      asset: "0x4D85bA8c3918359c78Ed09581E5bc7578ba932ba",
      assetDustEVault: "0x911Af5Bf5b7dd0F83869Ba857eDfDC3dea8254C2",
    },
    {
      chainId: 146,
      protocol: "wOS",
      vault: "0x9F0dF7799f6FDAd409300080cfF680f5A23df4b1",
      asset: "0xb1e25689D55734FD3ffFc939c4C3Eb52DFf8A794",
      assetDustEVault: "0x1E1482E7Bc32cD085d7aF61F29019Ba372B63277",
    },
    // {
    //   chainId: 1,
    //   protocol: "sUSDS",
    //   vault: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
    //   asset: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
    //   assetDustEVault: "0x98238Ee86f2c571AD06B0913bef21793dA745F57",
    // },
  ],
}

// Wrapper which adds an ERC4626 deposit or withdraw in front or at the back of a trade
export class StrategyERC4626Wrapper {
  static name() {
    return "erc4626_wrapper"
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
          (isAddressEqual(v.vault, swapParams.tokenIn.addressInfo) ||
            isAddressEqual(v.vault, swapParams.tokenOut.addressInfo)),
      )
    )
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyERC4626Wrapper.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (this.isSupportedVault(swapParams.tokenIn.addressInfo)) {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenIn.addressInfo,
                underlying: swapParams.tokenOut.addressInfo,
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
                vault: swapParams.tokenOut.addressInfo,
                underlying: swapParams.tokenIn.addressInfo,
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
          if (this.isSupportedVault(swapParams.tokenIn.addressInfo)) {
            if (
              this.isSupportedVaultUnderlying({
                vault: swapParams.tokenIn.addressInfo,
                underlying: swapParams.tokenOut.addressInfo,
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
                vault: swapParams.tokenOut.addressInfo,
                underlying: swapParams.tokenIn.addressInfo,
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
      swapParams.tokenIn.addressInfo,
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
          providerName: this.getSupportedVault(swapParams.tokenIn.addressInfo)
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
      swapMulticallItem: redeemMulticallItem,
      amountOut: redeemAmountOut,
    } = await encodeRedeem(
      swapParams,
      swapParams.tokenIn.addressInfo,
      swapParams.amount,
      swapParams.from,
    )

    const vaultData = this.getSupportedVault(swapParams.tokenIn.addressInfo)
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
        swapParams.accountOut,
      )

      const multicallItems = [
        redeemMulticallItem,
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
    const vaultData = this.getSupportedVault(swapParams.tokenOut.addressInfo)

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
    const vaultData = this.getSupportedVault(swapParams.tokenOut.addressInfo)
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
    const vaultData = this.getSupportedVault(swapParams.tokenIn.addressInfo)
    const withdrawAmount = adjustForInterest(swapParams.amount)

    const {
      swapMulticallItem: withdrawMulticallItem,
      amountIn,
      amountOut,
    } = await encodeWithdraw(
      swapParams,
      vaultData.vault,
      withdrawAmount,
      swapParams.from,
    )

    const multicallItems = [withdrawMulticallItem]
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
    const vaultData = this.getSupportedVault(swapParams.tokenIn.addressInfo)
    const tokenIn = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      vaultIn: vaultData.assetDustEVault,
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
          swapMulticallItem: withdrawMulticallItem,
          amountIn: withdrawAmountIn,
        } = await encodeWithdraw(
          withdrawSwapParams,
          vaultData.vault,
          BigInt(innerQuote.amountIn),
          swapParams.from,
        )

        // repay or exact out will return unused input, which is the intermediate asset
        const multicallItems = [
          withdrawMulticallItem,
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
    const vaultData = this.getSupportedVault(swapParams.tokenOut.addressInfo)

    const mintAmount = adjustForInterest(swapParams.amount)

    const {
      swapMulticallItem: mintMulticallItem,
      amountIn,
      amountOut,
    } = await encodeMint(
      swapParams,
      vaultData.vault,
      mintAmount,
      swapParams.from,
    )

    // mint is encoded in target debt mode, so repay will happen automatically
    const multicallItems = [mintMulticallItem]

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
    const vaultData = this.getSupportedVault(swapParams.tokenOut.addressInfo)

    const mintAmount = adjustForInterest(swapParams.amount)
    const tokenIn = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenIn) throw new Error("Inner token in not found")
    const mintSwapParams = {
      ...swapParams,
      tokenIn,
      vaultIn: vaultData.assetDustEVault,
    }

    const {
      swapMulticallItem: mintMulticallItem,
      amountIn: mintAmountIn,
      amountOut,
    } = await encodeMint(
      mintSwapParams,
      vaultData.vault,
      mintAmount,
      swapParams.from,
    )

    const tokenOut = findToken(swapParams.chainId, vaultData.asset)
    if (!tokenOut) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      amount: mintAmountIn,
      tokenOut,
      receiver: swapParams.from,
      onlyFixedInputExactOut: true, // this option will overswap, which should cover growing exchange rate
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return innerQuotes.map((innerQuote) => {
      // re-encode inner swap from target debt to exact out so that repay is not executed before mint TODO fix with exact out support in all strategies
      const innerSwapItems = innerQuote.swap.multicallItems.map((item) => {
        if (item.functionName !== "swap") return item

        const newItem = encodeSwapMulticallItem({
          ...item.args[0],
          mode: BigInt(SwapperMode.EXACT_OUT),
        })

        return newItem
      })

      // repay is done through mint item, which will return unused input, which is the intermediate asset
      const multicallItems = [...innerSwapItems, mintMulticallItem]

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
    tokenIn: swapParams.tokenIn.addressInfo,
    tokenOut: swapParams.tokenOut.addressInfo,
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

export async function encodeWithdraw(
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
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    name: "withdraw",
    stateMutability: "nonpayable",
    type: "function",
  }

  const withdrawData = encodeFunctionData({
    abi: [abiItem],
    args: [amountOut, receiver, swapParams.from],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    vault,
    withdrawData,
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
    tokenIn: swapParams.tokenIn.addressInfo,
    tokenOut: swapParams.tokenOut.addressInfo,
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
    tokenIn: swapParams.tokenIn.addressInfo,
    tokenOut: swapParams.tokenOut.addressInfo,
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
