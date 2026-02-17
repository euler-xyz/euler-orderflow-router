import qs from "qs"
import {
  type Address,
  encodeAbiParameters,
  getAddress,
  isAddressEqual,
  parseAbiParameters,
} from "viem"
import { type SwapApiResponse, SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_GENERIC,
  adjustForInterest,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  buildApiResponseVerifySkimMin,
  encodeDepositMulticallItem,
  encodeSwapMulticallItem,
  encodeTargetDebtAsExactInMulticall,
  findToken,
  includesCustomProvider,
  isExactInRepay,
  matchParams,
} from "../utils"

const dustDepositVaults: [
  {
    chainId: number
    symbol: string
    asset: Address
    assetDustEVault: Address
  },
] = [
  {
    chainId: 43114,
    symbol: "USDe",
    asset: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
    assetDustEVault: "0x98b8d70fa7d790d09fc8efb49c483637d02d416a",
  },
]

// DEPRECATED IN FAVOR OF QUOTE SOURCE IN AGGREGATORS

// Strategy handling Pendle cross chain PT swaps on spoke chains. Only from PT to any.
export class StrategyPendleCrossChainPT {
  static name() {
    return "pendle_cross_chain_pt"
  }
  readonly match
  readonly config

  constructor(match = {}, config = {}) {
    this.match = match
    this.config = config
  }

  async supports(swapParams: SwapParams) {
    return (
      !isExactInRepay(swapParams) &&
      Boolean(swapParams.tokenIn.metadata?.isPendleCrossChainPT)
    )
  }

  async providers(): Promise<string[]> {
    return ["custom"]
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyPendleCrossChainPT.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result
    if (!swapParams.tokenIn.metadata?.pendleCrossChainPTPaired)
      throw new Error("Missing token metadata") // type assertion

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (
            isAddressEqual(
              swapParams.tokenOut.address,
              getAddress(swapParams.tokenIn.metadata.pendleCrossChainPTPaired),
            )
          ) {
            result.quotes = includesCustomProvider(swapParams)
              ? [await this.exactInFromPTToUnderlying(swapParams)]
              : []
          } else {
            result.quotes = await this.exactInFromPTToAny(swapParams)
          }
          break
        }
        case SwapperMode.TARGET_DEBT: {
          if (
            isAddressEqual(
              swapParams.tokenOut.address,
              getAddress(swapParams.tokenIn.metadata.pendleCrossChainPTPaired),
            )
          ) {
            result.quotes = includesCustomProvider(swapParams)
              ? await this.targetDebtFromPTToUnderlying(swapParams)
              : []
          } else {
            result.quotes = await this.targetDebtFromPTToAny(swapParams)
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

  async exactInFromPTToUnderlying(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse> {
    const { swapMulticallItem: ptSwapMulticallItem, amountOut: ptAmountOut } =
      await fetchAndEncodePTQuote(
        swapParams,
        "pt",
        swapParams.amount,
        swapParams.receiver,
      )

    const multicallItems = [ptSwapMulticallItem]
    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const verify = buildApiResponseVerifySkimMin(
      swapParams.chainId,
      swapParams.receiver,
      swapParams.accountOut,
      ptAmountOut,
      swapParams.deadline,
    )

    return {
      amountIn: String(swapParams.amount),
      amountInMax: String(swapParams.amount),
      amountOut: String(ptAmountOut),
      amountOutMin: String(ptAmountOut),
      vaultIn: swapParams.vaultIn,
      receiver: swapParams.receiver,
      accountIn: swapParams.accountIn,
      accountOut: swapParams.accountOut,
      tokenIn: swapParams.tokenIn,
      tokenOut: swapParams.tokenOut,
      slippage: 0,
      route: [
        {
          providerName: "Pendle",
        },
      ],
      swap,
      verify,
    }
  }

  async exactInFromPTToAny(swapParams: SwapParams): Promise<SwapApiResponse[]> {
    const { swapMulticallItem: ptSwapMulticallItem, amountOut: ptAmountOut } =
      await fetchAndEncodePTQuote(
        swapParams,
        "pt",
        swapParams.amount,
        swapParams.receiver,
      )

    if (!swapParams.tokenIn.metadata?.pendleCrossChainPTPaired)
      throw new Error("Missing token metadata")
    const pairedAsset = getAddress(
      swapParams.tokenIn.metadata.pendleCrossChainPTPaired,
    )
    const tokenIn = findToken(swapParams.chainId, pairedAsset)

    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      amount: ptAmountOut,
    }

    const innerSwaps = await runPipeline(innerSwapParams)

    return innerSwaps.map((innerSwap) => {
      const intermediateDustDepositMulticallItem = encodeDepositMulticallItem(
        pairedAsset,
        this.getAssetDustEVault(pairedAsset),
        5n, // avoid zero shares
        swapParams.dustAccount,
      )

      const multicallItems = [
        ptSwapMulticallItem,
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
        route: [{ providerName: "Pendle" }, ...innerSwap.route],
        swap,
        verify,
      }
    })
  }

  async targetDebtFromPTToUnderlying(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const amountOut = adjustForInterest(swapParams.amount)

    const { data: ptSwapData, amountIn } = await fetchAndEncodePTQuote(
      swapParams,
      "token",
      swapParams.amount,
      swapParams.receiver,
    )

    const multicallItems = encodeTargetDebtAsExactInMulticall(
      swapParams,
      ptSwapData,
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
        route: [{ providerName: "Pendle" }],
        swap,
        verify,
      },
    ]
  }

  async targetDebtFromPTToAny(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    if (!swapParams.tokenIn.metadata?.pendleCrossChainPTPaired)
      throw new Error("Missing token metadata")
    const pairedAsset = getAddress(
      swapParams.tokenIn.metadata.pendleCrossChainPTPaired,
    )
    const tokenIn = findToken(swapParams.chainId, pairedAsset)
    if (!tokenIn) throw new Error("Inner token not found")

    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      vaultIn: this.getAssetDustEVault(pairedAsset),
      accountIn: swapParams.dustAccount,
      onlyFixedInputExactOut: true, // eliminate dust in the intermediate asset (vault underlying)
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return await Promise.all(
      innerQuotes.map(async (innerQuote) => {
        const ptSwapParams = {
          ...swapParams,
          swapperMode: SwapperMode.EXACT_IN, // change to exact in, otherwise multicall item will be target debt and will attempt a repay
        }

        const { swapMulticallItem: ptSwapMulticallItem, amountIn } =
          await fetchAndEncodePTQuote(
            ptSwapParams,
            "token",
            BigInt(innerQuote.amountIn),
            swapParams.from,
          )

        // repay or exact out will return unused input, which is the intermediate asset
        const multicallItems = [
          ptSwapMulticallItem,
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
          amountIn: String(amountIn),
          amountInMax: String(amountIn),
          amountOut: String(innerQuote.amountOut),
          amountOutMin: String(innerQuote.amountOutMin),
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: [{ providerName: "Pendle" }, ...innerQuote.route],
          swap,
          verify,
        }
      }),
    )
  }

  getAssetDustEVault(asset: Address) {
    const data = dustDepositVaults.find((v) => isAddressEqual(v.asset, asset))
    if (!data) throw new Error("Dust vault not found")

    return getAddress(data.assetDustEVault)
  }
}

async function fetchAndEncodePTQuote(
  swapParams: SwapParams,
  exactAmountType: "pt" | "token",
  amount: bigint,
  receiver: Address,
) {
  const queryParams = {
    receiver,
    pt: swapParams.tokenIn.address,
    token: swapParams.tokenIn.metadata?.pendleCrossChainPTPaired,
    exactAmountType,
    exactAmount: amount,
  }

  const headers: Record<string, string> = {
    accept: "application/json",
  }
  if (process.env.PENDLE_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.PENDLE_API_KEY}`
  }
  const url = `https://api-v2.pendle.finance/core/v1/sdk/${swapParams.chainId}/swap-pt-cross-chain?${qs.stringify(queryParams)}`

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`Pendle API ${response.status}: ${response.statusText}`)
  }
  const {
    tx,
    data: { netTokenOut: amountOut, netPtIn: amountIn },
  } = await response.json()

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    tx.to,
    tx.data,
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
    amountIn: BigInt(amountIn),
    amountOut: BigInt(amountOut),
    swapMulticallItem,
    data: swapData,
  }
}
