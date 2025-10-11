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
      chainId: 1,
      protocol: "eUSDe",
      vault: "0x90D2af7d622ca3141efA4d8f1F24d86E5974Cc8F",
      asset: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
      assetDustEVault: "0x537469D2219Bf28EAc0B1199d142969163309969",
    },
    {
      chainId: 1,
      protocol: "sUSDf",
      vault: "0xc8CF6D7991f15525488b2A83Df53468D682Ba4B0",
      asset: "0xFa2B947eEc368f42195f24F36d2aF29f7c24CeC2",
      assetDustEVault: "0x7aC81B3172870397496bD30502a07Cc9BfBB25eE",
    },
    {
      chainId: 1,
      protocol: "sUSP",
      vault: "0x271C616157e69A43B4977412A64183Cf110Edf16",
      asset: "0x97cCC1C046d067ab945d3CF3CC6920D3b1E54c88",
      assetDustEVault: "0x15bdfb8701b40E2AC3C7e432801329159A54eBc8",
    },
    {
      chainId: 1,
      protocol: "pUSDe",
      vault: "0xA62B204099277762d1669d283732dCc1B3AA96CE",
      asset: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
      assetDustEVault: "0x537469D2219Bf28EAc0B1199d142969163309969",
    },
    {
      chainId: 1,
      protocol: "stcUSD",
      vault: "0x88887bE419578051FF9F4eb6C858A951921D8888",
      asset: "0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC",
      assetDustEVault: "0xe0695883730ddd5eb322A601e08890c301fFcc71",
    },
    {
      chainId: 1,
      protocol: "lstRZR",
      vault: "0xB33f4B9C6f0624EdeAE8881c97381837760D52CB",
      asset: "0xb4444468e444f89e1c2CAc2F1D3ee7e336cBD1f5",
      assetDustEVault: "0x9d289DE828E7616B062818aBCd3f9b0eE6df6e44",
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
    {
      chainId: 146,
      protocol: "yUSD",
      vault: "0x4772D2e014F9fC3a820C444e3313968e9a5C8121",
      asset: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
      assetDustEVault: "0x4de31E9d79AFb2d1C3Eb62F19F6eDF9aFe95A193",
    },
    {
      chainId: 1,
      protocol: "sUSDS",
      vault: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
      asset: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
      assetDustEVault: "0x98238Ee86f2c571AD06B0913bef21793dA745F57",
    },
    {
      chainId: 1,
      protocol: "sUSP",
      vault: "0x271C616157e69A43B4977412A64183Cf110Edf16",
      asset: "0x97cCC1C046d067ab945d3CF3CC6920D3b1E54c88",
      assetDustEVault: "0x15bdfb8701b40E2AC3C7e432801329159A54eBc8",
    },
    {
      chainId: 1,
      protocol: "sUSDaf",
      vault: "0x89E93172AEF8261Db8437b90c3dCb61545a05317",
      asset: "0x9Cf12ccd6020b6888e4D4C4e4c7AcA33c1eB91f8",
      assetDustEVault: "0xF31280f6E33Aa53Ea23E1982B2071b688e3a9cA2",
    },
    {
      chainId: 43114,
      protocol: "savUSD",
      vault: "0x06d47F3fb376649c3A9Dafe069B3D6E35572219E",
      asset: "0x24dE8771bC5DdB3362Db529Fc3358F2df3A0E346",
      assetDustEVault: "0xa9C92715dfED67a1Eb841c02059D9D0f1d508648",
    },
    {
      chainId: 80094,
      protocol: "sNECT",
      vault: "0x597877Ccf65be938BD214C4c46907669e3E62128",
      asset: "0x1cE0a25D13CE4d52071aE7e02Cf1F6606F4C79d3",
      assetDustEVault: "0xb20536709f1002F901ed7fE2271f1804fEe18F09",
    },
    {
      chainId: 80094,
      protocol: "BB.sNECT",
      vault: "0x1d22592F66Fc92e0a64eE9300eAeca548cd466c5",
      asset: "0x597877Ccf65be938BD214C4c46907669e3E62128",
      assetDustEVault: "0x4a0c6479b628A8D6696B0197AC29495F2E95F46c",
    },
    {
      chainId: 43114,
      protocol: "sdeUSD",
      vault: "0x68088C91446c7bEa49ea7Dbd3B96Ce62B272DC96",
      asset: "0xB57B25851fE2311CC3fE511c8F10E868932e0680",
      assetDustEVault: "0x1FF92f8C033a365de2d82d390a1799AbFCaD7394",
    },
    {
      chainId: 43114,
      protocol: "xUSDC",
      vault: "0xA39986F96B80d04e8d7AeAaF47175F47C23FD0f4",
      asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      assetDustEVault: "0xf524d75b7Fedf6301996A21337FFA45D330e60EF",
    },
    {
      chainId: 130,
      protocol: "sUSDC",
      vault: "0x14d9143BEcC348920b68D123687045db49a016C6",
      asset: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
      assetDustEVault: "0x2888F098157162EC4a4274F7ad2c69921e95834D",
    },
    {
      chainId: 8453,
      protocol: "yoUSD",
      vault: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetDustEVault: "0xD695BD489B1d8ad2214239753b710FE50275623f",
    },
    {
      chainId: 8453,
      protocol: "yoETH",
      vault: "0x3A43AEC53490CB9Fa922847385D82fe25d0E9De7",
      asset: "0x4200000000000000000000000000000000000006",
      assetDustEVault: "0xa00Ce534859ad1918508D0efa81D8b140cC69eBD",
    },
    {
      chainId: 8453,
      protocol: "yoBTC",
      vault: "0xbCbc8cb4D1e8ED048a6276a5E94A3e952660BcbC",
      asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      assetDustEVault: "0x9D3010d32F2b0541dEE280Fb7cD98326e042CA20",
    },
    {
      chainId: 146,
      protocol: "lstRZR",
      vault: "0x67A298e5B65dB2b4616E05C3b455E017275f53cB",
      asset: "0xb4444468e444f89e1c2CAc2F1D3ee7e336cBD1f5",
      assetDustEVault: "0x8B3779350Ac93eab1bEa44F96167580C1Ae6e846",
    },
    {
      chainId: 42161,
      protocol: "sUSDC",
      vault: "0x940098b108fB7D0a7E374f6eDED7760787464609",
      asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      assetDustEVault: "0xC078756d5722166Ba6B51121bFB7bd6388C29F4E",
    },
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
        swapParams.dustAccount,
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
      data: withdrawData,
      amountIn,
      amountOut,
    } = await encodeWithdraw(
      swapParams,
      vaultData.vault,
      withdrawAmount,
      swapParams.from,
    )

    const multicallItems = encodeTargetDebtAsExactInMulticall(
      swapParams,
      withdrawData,
    )
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
    const vaultData = this.getSupportedVault(swapParams.tokenOut.addressInfo)

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
    data: swapData,
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
