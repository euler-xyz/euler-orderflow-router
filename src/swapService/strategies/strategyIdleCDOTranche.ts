import { viemClients } from "@/common/utils/viemClients"
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  maxUint256,
  parseAbiParameters,
  publicActions,
} from "viem"
import { type SwapApiResponse, SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_GENERIC,
  applySlippage,
  buildApiResponseSwap,
  buildApiResponseVerifySkimMin,
  encodeSwapMulticallItem,
  findToken,
  includesCustomProvider,
  isExactInRepay,
  matchParams,
} from "../utils"

const defaultConfig: {
  supportedTranches: Array<{
    chainId: number
    swapHandler: Address
    cdo: Address
    aaTranche: Address
    aaTrancheVault: Address
    underlying: Address
    underlyingDecimals: bigint
    priceOne: bigint
  }>
} = {
  supportedTranches: [
    {
      // IdleCDO AA Tranche - idle_Fasanara
      chainId: 1,
      swapHandler: "0xA24689b6Ab48eCcF7038c70eBC39f9ed4217aFE3",
      cdo: "0xf6223C567F21E33e859ED7A045773526E9E3c2D5",
      aaTranche: "0x45054c6753b4Bce40C5d54418DabC20b070F85bE",
      aaTrancheVault: "0xd820C8129a853a04dC7e42C64aE62509f531eE5A",
      underlying: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      underlyingDecimals: 6n,
      priceOne: 1000000n,
    },
  ],
}

const PROTOCOL = { providerName: "Idle" }

// Strategy uses a special SwapHandler contract, which deposits into IdleCDO tranches
export class StrategyIdleCDOTranche {
  static name() {
    return "idle_cdo_tranche"
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
      this.config.supportedTranches.some(
        (v) =>
          swapParams.swapperMode === SwapperMode.EXACT_IN &&
          v.chainId === swapParams.chainId &&
          // only deposits into the tranche are possible atomically
          isAddressEqual(v.aaTranche, swapParams.tokenOut.address) &&
          swapParams.receiver === v.aaTrancheVault,
      )
    )
  }

  async providers(): Promise<string[]> {
    return ["custom"]
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyIdleCDOTranche.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (this.isSupportedTranche(swapParams.tokenIn.address)) {
            throw new Error("Not supported")
          }
          if (
            this.isSupportedTrancheUnderlying({
              aaTranche: swapParams.tokenOut.address,
              underlying: swapParams.tokenIn.address,
            })
          ) {
            result.quotes = includesCustomProvider(swapParams)
              ? await this.exactInFromUnderlyingToTranche(swapParams)
              : []
          } else {
            result.quotes = await this.exactInFromAnyToTranche(swapParams)
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

  async exactInFromUnderlyingToTranche(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const trancheData = this.getSupportedTranche(swapParams.tokenOut.address)

    const amountOut = await this.getDepositAmountOut(
      swapParams.chainId,
      trancheData.aaTranche,
      swapParams.amount,
    )

    const swapHandlerMulticallItem = this.encodeSwapToTrancheSwapMulticallItem(
      trancheData.aaTranche,
      swapParams,
      swapParams.amount,
    )

    const multicallItems = [swapHandlerMulticallItem]

    const swap = buildApiResponseSwap(swapParams.from, multicallItems)

    const amountOutMin = amountOut // tranche price should not decrease under normal circumstances
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

  async exactInFromAnyToTranche(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const trancheData = this.getSupportedTranche(swapParams.tokenOut.address)
    const tokenOut = findToken(swapParams.chainId, trancheData.underlying)
    if (!tokenOut) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenOut,
      receiver: swapParams.from,
    }
    const innerSwaps = await runPipeline(innerSwapParams)

    return Promise.all(
      innerSwaps.map(async (innerSwap) => {
        const amountOut = await this.getDepositAmountOut(
          swapParams.chainId,
          trancheData.aaTranche,
          BigInt(innerSwap.amountOut),
        )
        const amountOutMin = applySlippage(amountOut, swapParams.slippage)

        const swapHandlerMulticallItem =
          await this.encodeSwapToTrancheSwapMulticallItem(
            trancheData.aaTranche,
            swapParams,
            maxUint256, // this will deposit everything that was bought in the inner swapllol
          )

        const multicallItems = [
          ...innerSwap.swap.multicallItems,
          swapHandlerMulticallItem,
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
          route: [PROTOCOL, ...innerSwap.route],
          swap,
          verify,
        }
      }),
    )
  }

  encodeSwapToTrancheSwapMulticallItem(
    tranche: Address,
    swapParams: SwapParams,
    amountIn: bigint,
  ) {
    const trancheData = this.getSupportedTranche(tranche)

    const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
      trancheData.swapHandler,
      encodeSwapExactTokensForAATranche(amountIn),
    ])

    const swapperAmountOut =
      swapParams.swapperMode === SwapperMode.EXACT_IN
        ? 0n //ignored
        : swapParams.targetDebt

    const swapHandlerMulticallItem = encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(swapParams.swapperMode),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.address,
      tokenOut: tranche,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: swapperAmountOut,
      data: swapData,
    })

    return swapHandlerMulticallItem
  }

  async getDepositAmountOut(
    chainId: number,
    tranche: Address,
    amountIn: bigint,
  ) {
    const trancheData = this.getSupportedTranche(tranche)

    const virtualPrice = await fetchVirtualPrice(
      chainId,
      trancheData.cdo,
      trancheData.aaTranche,
    )
    const amountOut =
      (amountIn *
        trancheData.priceOne *
        10n ** (18n - trancheData.underlyingDecimals)) /
      virtualPrice

    return amountOut
  }

  async getWithdrawAmountOut(
    chainId: number,
    tranche: Address,
    amountIn: bigint,
  ) {
    const trancheData = this.getSupportedTranche(tranche)

    const virtualPrice = await fetchVirtualPrice(
      chainId,
      trancheData.cdo,
      trancheData.aaTranche,
    )
    const amountOut =
      (amountIn *
        virtualPrice *
        10n ** (18n - trancheData.underlyingDecimals)) /
      trancheData.priceOne

    return amountOut
  }

  isSupportedTranche(asset: Address) {
    return this.config.supportedTranches.some((v) =>
      isAddressEqual(v.aaTranche, asset),
    )
  }

  isSupportedTrancheUnderlying({
    aaTranche,
    underlying,
  }: { aaTranche: Address; underlying: Address }) {
    const asset = this.config.supportedTranches.find((v) =>
      isAddressEqual(v.aaTranche, aaTranche),
    )?.underlying
    return !!asset && isAddressEqual(asset, underlying)
  }

  getSupportedTranche(aaTranche: Address) {
    const supportedTranche = this.config.supportedTranches.find((v) =>
      isAddressEqual(v.aaTranche, aaTranche),
    )
    if (!supportedTranche) throw new Error("Tranche not supported")

    return supportedTranche
  }
}

export async function fetchVirtualPrice(
  chainId: number,
  cdo: Address,
  tranche: Address,
) {
  const client = getViemClient(chainId)
  const abiItem = {
    name: "virtualPrice",
    inputs: [{ name: "_tranche", type: "address" }],
    outputs: [{ name: "_virtualPrice", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  }

  const query = {
    address: cdo,
    abi: [abiItem],
    functionName: "virtualPrice",
    args: [tranche],
  } as const

  const data = (await client.readContract(query)) as bigint

  return data
}

const getViemClient = (chainId: number) => {
  if (!viemClients[chainId])
    throw new Error(`No client found for chainId ${chainId}`)
  return viemClients[chainId].extend(publicActions)
}

function encodeSwapExactTokensForAATranche(amount: bigint) {
  const abiItem = {
    inputs: [{ name: "amountIn", type: "uint256" }],
    name: "swapExactTokensForAATranche",
    stateMutability: "nonpayable",
    type: "function",
  }

  const functionData = encodeFunctionData({
    abi: [abiItem],
    args: [amount],
  })

  return functionData
}
