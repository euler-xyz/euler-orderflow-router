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
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_GENERIC,
  adjustForInterest,
  applySlippage,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  buildApiResponseVerifySkimMin,
  encodeSwapMulticallItem,
  isExactInRepay,
  matchParams,
} from "../utils"

type SupportedPool = {
  chainId: number
  lp: Address
  assets: Address[]
  assetDustEVaults: Address[]
}

const defaultConfig: {
  supportedPools: SupportedPool[]
} = {
  supportedPools: [
    // cUSDO/USDC
    {
      chainId: 1,
      lp: "0x90455bd11Ce8a67C57d467e634Dc142b8e4105Aa",
      assets: [
        "0xaD55aebc9b8c03FC43cd9f62260391c13c23e7c0",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      ],
      assetDustEVaults: [
        "0x738bC1e2F68F5ec58ea456fb4269B4b3f51714b5",
        "0xb93d4928f39fbcd6c89a7dfbf0a867e6344561be",
      ], // ecUSDO-1, eUSDC-1 escrow
    },
  ],
}

const PROTOCOL = { providerName: "Curve" }

// Wrapper which adds or removes liquidity from Curve StableSwapNG pools to swap to and from LP tokens
export class StrategyCurveLPNG {
  static name() {
    return "curve_lp_ng"
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
      this.config.supportedPools.some(
        (v) =>
          v.chainId === swapParams.chainId &&
          (isAddressEqual(v.lp, swapParams.tokenIn.address) ||
            isAddressEqual(v.lp, swapParams.tokenOut.address)),
      )
    )
  }

  async providers(): Promise<string[]> {
    return ["custom"]
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyCurveLPNG.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (this.isSupportedLP(swapParams.tokenIn.address)) {
            if (
              this.isSupportedLPAsset({
                lp: swapParams.tokenIn.address,
                asset: swapParams.tokenOut.address,
              })
            ) {
              result.quotes = await this.exactInFromLPToAsset(swapParams)
            } else {
              throw new Error("Not supported")
            }
          } else {
            if (
              this.isSupportedLPAsset({
                lp: swapParams.tokenOut.address,
                asset: swapParams.tokenIn.address,
              })
            ) {
              result.quotes = await this.exactInFromAssetToLP(swapParams)
            } else {
              throw new Error("Not supported")
            }
          }
          break
        }
        case SwapperMode.TARGET_DEBT: {
          if (this.isSupportedLP(swapParams.tokenIn.address)) {
            if (
              this.isSupportedLPAsset({
                lp: swapParams.tokenIn.address,
                asset: swapParams.tokenOut.address,
              })
            ) {
              result.quotes = await this.targetDebtFromLPToAsset(swapParams)
            } else {
              throw new Error("Not supported")
            }
          } else {
            throw new Error("Not supported")
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

  async exactInFromLPToAsset(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const lpData = this.getSupportedLP(swapParams.tokenIn.address)
    const assetIndex = lpData.assets.findIndex((a) =>
      isAddressEqual(a, swapParams.tokenOut.address),
    )

    const amountOut = await fetchCalcWithdrawOneCoin(
      swapParams.chainId,
      lpData.lp,
      swapParams.amount,
      assetIndex,
    )

    const amountOutMin = applySlippage(amountOut, swapParams.slippage)
    const { swapMulticallItem: removeLiquidityMulticallItem } =
      encodeRemoveLiquidityOneCoinMulticallItem(
        swapParams,
        lpData.lp,
        assetIndex,
        swapParams.amount,
        amountOut,
        swapParams.receiver,
      )

    const multicallItems = [removeLiquidityMulticallItem]
    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

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
        slippage: 0,
        route: [PROTOCOL],
        swap,
        verify,
      },
    ]
  }

  async exactInFromAssetToLP(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const lpData = this.getSupportedLP(swapParams.tokenOut.address)
    const amounts = this.getAmounts(
      lpData,
      swapParams.tokenIn.address,
      swapParams.amount,
    )

    const { amountOut, swapMulticallItem: swapperAddLiquidityMulticallItem } =
      await encodeAddLiquidityMulticallItem(
        swapParams,
        lpData.lp,
        amounts,
        swapParams.receiver,
      )

    const multicallItems = [swapperAddLiquidityMulticallItem]

    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const amountOutMin = applySlippage(amountOut, swapParams.slippage)
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
        route: [PROTOCOL],
        swap,
        verify,
      },
    ]
  }

  async targetDebtFromLPToAsset(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const lpData = this.getSupportedLP(swapParams.tokenIn.address)
    const amountOut = adjustForInterest(swapParams.amount)
    const amounts = this.getAmounts(
      lpData,
      swapParams.tokenOut.address,
      amountOut,
    )

    const amountIn = await fetchCalcTokenAmount(
      swapParams.chainId,
      lpData.lp,
      amounts,
      false,
    )

    const { swapMulticallItem: withdrawMulticallItem } =
      encodeRemoveLiquidityOneCoinMulticallItem(
        swapParams,
        lpData.lp,
        amounts.findIndex((a) => a !== 0n),
        amountIn,
        amountOut,
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
        amountOutMin: String(swapParams.amount),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: 0,
        route: [PROTOCOL],
        swap,
        verify,
      },
    ]
  }

  isSupportedLP(lp: Address) {
    return this.config.supportedPools.some((p) => isAddressEqual(p.lp, lp))
  }

  isSupportedLPAsset({ lp, asset }: { lp: Address; asset: Address }) {
    const assets = this.config.supportedPools.find((p) =>
      isAddressEqual(p.lp, lp),
    )?.assets
    return !!assets && assets.some((a) => isAddressEqual(a, asset))
  }

  getSupportedLP(lp: Address) {
    const supportedLP = this.config.supportedPools.find((p) =>
      isAddressEqual(p.lp, lp),
    )
    if (!supportedLP) throw new Error("Pool not supported")

    return supportedLP
  }

  getAssetIndex(lpData: SupportedPool, asset: Address) {
    const index = lpData.assets.findIndex((a) => isAddressEqual(a, asset))
    if (index === -1) throw new Error("Asset not found")
    return index
  }

  getAmounts(lpData: SupportedPool, asset: Address, amount: bigint): bigint[] {
    const index = lpData.assets.findIndex((a) => isAddressEqual(a, asset))
    if (index === -1) throw new Error("Asset not found")
    const amounts = Array(lpData.assets.length).fill(0n)
    amounts[index] = amount
    return amounts
  }
}

const encodeAddLiquidityMulticallItem = async (
  swapParams: SwapParams,
  lp: Address,
  amounts: bigint[],
  receiver: Address,
) => {
  const amountOut = await fetchCalcTokenAmount(
    swapParams.chainId,
    lp,
    amounts,
    true,
  )

  const amountOutMin = applySlippage(amountOut, swapParams.slippage)

  const abiItem = {
    name: "add_liquidity",
    inputs: [
      { name: "_amounts", type: "uint256[]" },
      { name: "_min_mint_amount", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  }

  const addLiquidityData = encodeFunctionData({
    abi: [abiItem],
    args: [amounts, amountOutMin, receiver],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    lp,
    addLiquidityData,
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
    amountIn: amounts.find((a) => a !== 0n),
    amountOut,
    swapMulticallItem,
  }
}

const encodeRemoveLiquidityOneCoinMulticallItem = (
  swapParams: SwapParams,
  lp: Address,
  assetIndex: number,
  amount: bigint,
  amountOut: bigint,
  receiver: Address,
) => {
  const amountOutMin = applySlippage(amountOut, swapParams.slippage)
  const abiItem = {
    name: "remove_liquidity_one_coin",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "int128" },
      { name: "_min_received", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  }

  const removeLiquidityData = encodeFunctionData({
    abi: [abiItem],
    args: [amount, assetIndex, amountOutMin, receiver],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    lp,
    removeLiquidityData,
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
    amountIn: amount,
    amountOut,
    swapMulticallItem,
  }
}

async function fetchCalcTokenAmount(
  chainId: number,
  lp: Address,
  amounts: bigint[],
  isDeposit: boolean,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "calc_token_amount",
    inputs: [
      { name: "_amounts", type: "uint256[]" },
      { name: "_is_deposit", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: lp,
    abi: [abiItem],
    functionName: "calc_token_amount",
    args: [amounts, isDeposit],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

async function fetchCalcWithdrawOneCoin(
  chainId: number,
  lp: Address,
  amount: bigint,
  coinIndex: number,
) {
  const client = getViemClient(chainId)

  const abiItem = {
    name: "calc_withdraw_one_coin",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "int128" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: lp,
    abi: [abiItem],
    functionName: "calc_withdraw_one_coin",
    args: [amount, coinIndex],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

const getViemClient = (chainId: number) => {
  if (!viemClients[chainId])
    throw new Error(`No client found for chainId ${chainId}`)
  return viemClients[chainId].extend(publicActions)
}
