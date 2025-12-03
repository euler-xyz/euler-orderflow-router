import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbiParameters,
} from "viem"
import { mainnet } from "viem/chains"
import { type SwapApiResponse, SwapperMode } from "../interface"
import { runPipeline } from "../runner"
import type { StrategyResult, SwapParams } from "../types"
import {
  SWAPPER_HANDLER_GENERIC,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  buildApiResponseVerifySkimMin,
  encodeSwapMulticallItem,
  encodeTargetDebtAsExactInMulticall,
  findToken,
  includesCustomProvider,
  isExactInRepay,
  matchParams,
} from "../utils"

const WRAPPER_TOOL: Record<number, Address> = {
  [mainnet.id]: getAddress("0x09cc0ccaf92382E6EcD04246329d7249113c68EB"),
  [9745]: getAddress("0x94976c190B94C1B110Ef3Ac9f774131e8490E62d"),
}

const WRAPPER_PROVIDER_NAME = "Pendle LP Wrapper"

// Strategy which wraps/unwraps Pendle wrapped LPs and deposits/withdraws underlyings
export class StrategyPendleLP {
  static name() {
    return "pendle_lp"
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
      Boolean(
        swapParams.tokenIn.metadata?.isPendleWrappedLP ||
          swapParams.tokenOut.metadata?.isPendleWrappedLP,
      )
    )
  }

  async providers(): Promise<string[]> {
    return [] // relies on providers of underlying strategies
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyPendleLP.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      if (!WRAPPER_TOOL[swapParams.chainId])
        throw new Error("No wrapper tool found")

      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          if (swapParams.tokenIn.metadata?.isPendleWrappedLP) {
            result.quotes = await this.exactInFromWrappedLPToAny(swapParams)
          } else {
            result.quotes = includesCustomProvider(swapParams)
              ? await this.exactInFromAnyToWrappedLP(swapParams)
              : []
          }
          break
        }
        case SwapperMode.TARGET_DEBT: {
          if (swapParams.tokenIn.metadata?.isPendleWrappedLP) {
            result.quotes = await this.targetDebtFromWrappedLPToAny(swapParams)
          } else {
            result.quotes = includesCustomProvider(swapParams)
              ? await this.targetDebtFromAnyToWrappedLP(swapParams)
              : []
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

  async exactInFromWrappedLPToAny(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    const unwrapMulticallItem = await encodeUnwrapDirect(
      swapParams,
      swapParams.tokenIn.address,
      swapParams.amount,
      swapParams.from,
    )

    if (!swapParams.tokenIn.metadata?.pendleMarket)
      throw new Error("Missing input pendle market")
    const tokenIn = findToken(
      swapParams.chainId,
      getAddress(swapParams.tokenIn.metadata.pendleMarket),
    )

    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
    }

    const innerSwaps = await runPipeline(innerSwapParams)

    return innerSwaps.map((innerSwap) => {
      const multicallItems = [
        unwrapMulticallItem,
        ...innerSwap.swap.multicallItems,
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
        route: [{ providerName: WRAPPER_PROVIDER_NAME }, ...innerSwap.route],
        swap,
        verify,
      }
    })
  }

  async exactInFromAnyToWrappedLP(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    if (!swapParams.tokenOut.metadata?.pendleMarket)
      throw new Error("Missing output pendle market")

    const tokenOut = findToken(
      swapParams.chainId,
      getAddress(swapParams.tokenOut.metadata?.pendleMarket),
    )
    if (!tokenOut) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenOut,
      receiver: WRAPPER_TOOL[swapParams.chainId],
    }

    const innerSwaps = await runPipeline(innerSwapParams)
    return await Promise.all(
      innerSwaps.map(async (innerSwap) => {
        // Swapper.deposit will deposit all of available balance into the wrapper, and move the wrapper straight to receiver, where it can be skimmed
        const { swapMulticallItem: wrapMulticallItem } = encodeWrapWithTool(
          swapParams,
          tokenOut.address,
          swapParams.tokenOut.address,
          swapParams.receiver,
        )

        const multicallItems = [
          ...innerSwap.swap.multicallItems,
          wrapMulticallItem,
        ]

        const swap = buildApiResponseSwap(swapParams.from, multicallItems)
        const verify = buildApiResponseVerifySkimMin(
          swapParams.chainId,
          swapParams.receiver,
          swapParams.accountOut,
          BigInt(innerSwap.amountOutMin),
          swapParams.deadline,
        )

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
          route: [...innerSwap.route, { providerName: WRAPPER_PROVIDER_NAME }],
          swap,
          verify,
        }
      }),
    )
  }

  async targetDebtFromWrappedLPToAny(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    if (!swapParams.tokenIn.metadata?.pendleMarket)
      throw new Error("Missing input pendle market")
    const tokenIn = findToken(
      swapParams.chainId,
      getAddress(swapParams.tokenIn.metadata.pendleMarket),
    )
    if (!tokenIn) throw new Error("Inner token not found")
    const innerSwapParams = {
      ...swapParams,
      tokenIn,
      accountIn: swapParams.dustAccount,
      onlyFixedInputExactOut: true, // eliminate dust in the intermediate asset (vault underlying)
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return await Promise.all(
      innerQuotes.map(async (innerQuote) => {
        const unwrapSwapParams = {
          ...swapParams,
          swapperMode: SwapperMode.EXACT_IN, // change to exact in, otherwise multicall item will be target debt and will attempt a repay
        }
        const unwrapMulticallItem = await encodeUnwrapDirect(
          unwrapSwapParams,
          swapParams.tokenIn.address,
          BigInt(innerQuote.amountIn),
          swapParams.from,
        )

        // repay or exact out will return unused input, which is the intermediate asset
        const multicallItems = [
          unwrapMulticallItem,
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
          amountIn: String(swapParams.amount),
          amountInMax: String(swapParams.amount),
          amountOut: String(innerQuote.amountOut),
          amountOutMin: String(innerQuote.amountOutMin),
          vaultIn: swapParams.vaultIn,
          receiver: swapParams.receiver,
          accountIn: swapParams.accountIn,
          accountOut: swapParams.accountOut,
          tokenIn: swapParams.tokenIn,
          tokenOut: swapParams.tokenOut,
          slippage: swapParams.slippage,
          route: [{ providerName: WRAPPER_PROVIDER_NAME }, ...innerQuote.route],
          swap,
          verify,
        }
      }),
    )
  }

  async targetDebtFromAnyToWrappedLP(
    swapParams: SwapParams,
  ): Promise<SwapApiResponse[]> {
    if (!swapParams.tokenOut.metadata?.pendleMarket)
      throw new Error("Missing output pendle market")
    const lpToken = findToken(
      swapParams.chainId,
      getAddress(swapParams.tokenOut.metadata?.pendleMarket),
    )
    if (!lpToken) throw new Error("LP token in not found")

    const wrapSwapParams = {
      ...swapParams,
      tokenIn: lpToken,
      accountIn: swapParams.dustAccount,
      mode: SwapperMode.EXACT_IN,
    }

    const { data: wrapData } = await encodeWrapWithTool(
      wrapSwapParams,
      lpToken.address,
      swapParams.tokenOut.address,
      swapParams.from,
    )

    const wrapMulticallItems = encodeTargetDebtAsExactInMulticall(
      wrapSwapParams,
      wrapData,
    )

    const innerSwapParams = {
      ...swapParams,
      tokenOut: lpToken,
      receiver: swapParams.from,
      onlyFixedInputExactOut: true, // this option will overswap, which should cover growing exchange rate
      noRepayEncoding: true,
    }

    const innerQuotes = await runPipeline(innerSwapParams)

    return innerQuotes.map((innerQuote) => {
      const multicallItems = [
        ...innerQuote.swap.multicallItems,
        ...wrapMulticallItems,
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
        amountOut: String(innerQuote.amountOut),
        amountOutMin: String(innerQuote.amountOutMin),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: [...innerQuote.route, { providerName: WRAPPER_PROVIDER_NAME }],
        swap,
        verify,
      }
    })
  }
}

export async function encodeUnwrapDirect(
  swapParams: SwapParams,
  wrappedLP: Address,
  amountIn: bigint,
  receiver: Address,
) {
  const amountOut = amountIn // 1:1 conversion

  const abiItem = {
    inputs: [
      { name: "receiver", type: "address" },
      { name: "netWrapIn", type: "uint256" },
    ],
    name: "unwrap",
    stateMutability: "nonpayable",
    type: "function",
  }

  const unwrapData = encodeFunctionData({
    abi: [abiItem],
    args: [receiver, amountIn],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    wrappedLP,
    unwrapData,
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

  return swapMulticallItem
}

export function encodeWrapWithTool(
  swapParams: SwapParams,
  lp: Address,
  wrappedLP: Address,
  receiver: Address,
) {
  const abiItem = {
    inputs: [
      { name: "lpToken", type: "address" },
      { name: "wrapper", type: "address" },
      { name: "receiver", type: "address" },
    ],
    name: "wrap",
    stateMutability: "nonpayable",
    type: "function",
  }

  const wrapData = encodeFunctionData({
    abi: [abiItem],
    args: [lp, wrappedLP, receiver],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    WRAPPER_TOOL[swapParams.chainId],
    wrapData,
  ])

  if (swapParams.swapperMode === SwapperMode.EXACT_OUT)
    throw new Error("Mode not supported")

  const swapperAmountOut =
    swapParams.swapperMode === SwapperMode.EXACT_IN
      ? 0n //ignored
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
    swapMulticallItem,
    data: swapData,
  }
}
