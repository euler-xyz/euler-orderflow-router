import contractBook from "@/common/utils/contractBook"
import getTokenList, { type TokenListItem } from "@/common/utils/tokenList"
import type { StatusCodes } from "http-status-codes"
import {
  type Address,
  type ContractFunctionArgs,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  parseAbiParameters,
  parseUnits,
  stringToHex,
  zeroAddress,
} from "viem"
import {
  type StrategyMatchConfig,
  type SwapApiResponse,
  type SwapApiResponseMulticallItem,
  type SwapApiResponseSwap,
  type SwapApiResponseVerify,
  type SwapRouteItem,
  SwapVerificationType,
  SwapperMode,
} from "./interface"
import type { SwapParams, SwapQuote } from "./types"

export const SWAPPER_HANDLER_GENERIC = stringToHex("Generic", {
  size: 32,
})
export const SWAPPER_HANDLER_UNISWAP_V2 = stringToHex("UniswapV2", {
  size: 32,
})
export const SWAPPER_HANDLER_UNISWAP_V3 = stringToHex("UniswapV3", {
  size: 32,
})

export const findToken = (chainId: number, tokenAddress: Address) => {
  const token = getTokenList(chainId).find((t: TokenListItem) =>
    isAddressEqual(t.addressInfo, tokenAddress),
  )
  return token
}

// TODO move to base class
export function matchParams(
  swapParams: SwapParams,
  match: StrategyMatchConfig = {},
): boolean {
  if (match.swapperModes) {
    if (!match.swapperModes.includes(swapParams.swapperMode)) return false
  }
  if (match.tokensInOrOut) {
    if (
      !match.tokensInOrOut.some((token: Hex) => {
        return (
          isAddressEqual(swapParams.tokenIn.addressInfo, token) ||
          isAddressEqual(swapParams.tokenOut.addressInfo, token)
        )
      })
    )
      return false
  }
  if (match.isRepay) {
    if (swapParams.isRepay !== match.isRepay) return false
  }
  if (match.isPendlePT) {
    if (
      !swapParams.tokenIn.meta?.isPendlePT &&
      !swapParams.tokenOut.meta?.isPendlePT
    )
      return false
  }

  return true
}

export function buildApiResponseVerifySkimMin(
  chainId: number,
  vault: Address,
  account: Address,
  amountMin: bigint,
  deadline: number,
): SwapApiResponseVerify {
  const verifierAddress = getVerifier(chainId)

  const verifierData = encodeFunctionData({
    abi: contractBook.swapVerifier.abi,
    functionName: "verifyAmountMinAndSkim",
    args: [vault, account, amountMin, BigInt(deadline)],
  })
  return {
    verifierAddress,
    verifierData,
    type: SwapVerificationType.SkimMin,
    vault,
    account,
    amount: String(amountMin),
    deadline,
  }
}

export class ApiError extends Error {
  readonly statusCode: StatusCodes
  readonly data: any
  constructor(statusCode: StatusCodes, message: string, data?: any) {
    super(message)
    this.statusCode = statusCode
    this.data = data
  }
}

export function buildApiResponseVerifyDebtMax(
  chainId: number,
  vault: Address,
  account: Address,
  amountMax: bigint,
  deadline: number,
): SwapApiResponseVerify {
  const verifierAddress = getVerifier(chainId)

  const verifierData = encodeFunctionData({
    abi: contractBook.swapVerifier.abi,
    functionName: "verifyDebtMax",
    args: [vault, account, amountMax, BigInt(deadline)],
  })
  return {
    verifierAddress,
    verifierData,
    type: SwapVerificationType.DebtMax,
    vault,
    account,
    amount: String(amountMax),
    deadline,
  }
}

export function buildApiResponseSwap(
  swapperAddress: Address,
  multicallItems: SwapApiResponseMulticallItem[],
): SwapApiResponseSwap {
  const swapperData = encodeFunctionData({
    abi: contractBook.swapper.abi,
    functionName: "multicall",
    args: [multicallItems.map((i) => i.data)],
  })

  return {
    swapperAddress,
    swapperData,
    multicallItems,
  }
}

export function buildApiResponseExactInputFromQuote(
  swapParams: SwapParams,
  quote: SwapQuote,
): SwapApiResponse {
  const amountOutMin = applySlippage(quote.amountOut, swapParams.slippage)

  const multicallItems = [
    encodeSwapMulticallItem({
      handler: SWAPPER_HANDLER_GENERIC,
      mode: BigInt(SwapperMode.EXACT_IN),
      account: swapParams.accountOut,
      tokenIn: swapParams.tokenIn.addressInfo,
      tokenOut: swapParams.tokenOut.addressInfo,
      vaultIn: swapParams.vaultIn,
      accountIn: swapParams.accountIn,
      receiver: swapParams.receiver,
      amountOut: 0n, // ignored in exact in
      data: quote.data,
    }),
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
    amountOut: String(quote.amountOut),
    amountOutMin: String(amountOutMin),
    vaultIn: swapParams.vaultIn,
    receiver: swapParams.receiver,
    accountIn: swapParams.accountIn,
    accountOut: swapParams.accountOut,
    tokenIn: swapParams.tokenIn,
    tokenOut: swapParams.tokenOut,
    slippage: swapParams.slippage,
    route: quoteToRoute(quote),
    swap,
    verify,
  }
}

export function addInOutDeposits(
  swapParams: SwapParams,
  response: SwapApiResponse,
): SwapApiResponse {
  const multicallItems = [
    ...response.swap.multicallItems,
    encodeDepositMulticallItem(
      swapParams.tokenIn.addressInfo,
      swapParams.vaultIn,
      1n,
      swapParams.accountIn,
    ),
    encodeDepositMulticallItem(
      swapParams.tokenOut.addressInfo,
      swapParams.receiver,
      1n,
      swapParams.accountOut,
    ),
  ]
  response.swap = buildApiResponseSwap(swapParams.from, multicallItems)

  return response
}

// TODO size dependant slippage
export const applySlippage = (
  amount: bigint,
  slippage: number,
  up = false,
): bigint => {
  // expecting slippage in percent
  if (slippage < 0 || slippage > 100) throw new Error("Bad slippage")
  let slippageScaled = BigInt((slippage * 1_000_000) / 100)
  if (up) slippageScaled *= -1n

  return (amount * (1_000_000n - slippageScaled)) / 1_000_000n
}

export const adjustForInterest = (debtAmount: bigint) =>
  (debtAmount * 10_001n) / 10_000n // TODO config

export const entriesBigintToString = (
  obj: Record<string, any>,
): Record<string, any> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, val]) =>
      typeof val === "bigint"
        ? [key, String(val)]
        : typeof val === "object"
          ? [key, entriesBigintToString(val)]
          : [key, val],
    ),
  )
}

export const encodeSwapMulticallItem = (
  params: ContractFunctionArgs<
    typeof contractBook.swapper.abi,
    "nonpayable",
    "swap"
  >[0],
): SwapApiResponseMulticallItem => {
  return {
    functionName: "swap",
    args: [entriesBigintToString(params)],
    data: encodeFunctionData({
      abi: contractBook.swapper.abi,
      functionName: "swap",
      args: [params],
    }),
  }
}

export const encodeDepositMulticallItem = (
  token: Address,
  vault: Address,
  amountMin: bigint,
  account: Address,
): SwapApiResponseMulticallItem => {
  return {
    functionName: "deposit",
    args: [token, vault, String(amountMin), account],
    data: encodeFunctionData({
      abi: contractBook.swapper.abi,
      functionName: "deposit",
      args: [token, vault, amountMin, account],
    }),
  }
}

export const encodeSweepMulticallItem = (
  token: Address,
  amountMin: bigint,
  to: Address,
): SwapApiResponseMulticallItem => {
  return {
    functionName: "sweep",
    args: [token, String(amountMin), to],
    data: encodeFunctionData({
      abi: contractBook.swapper.abi,
      functionName: "sweep",
      args: [token, amountMin, to],
    }),
  }
}

export const encodeRepayAndDepositMulticallItem = (
  token: Address,
  vault: Address,
  repayAmount: bigint,
  account: Address,
): SwapApiResponseMulticallItem => {
  return {
    functionName: "repayAndDeposit",
    args: [token, vault, String(repayAmount), account],
    data: encodeFunctionData({
      abi: contractBook.swapper.abi,
      functionName: "repayAndDeposit",
      args: [token, vault, repayAmount, account],
    }),
  }
}

export const getSwapper = (chainId: number) => {
  const swapper = contractBook.swapper.address[chainId] || ""
  if (!swapper) {
    throw new Error("Swapper contract not found for chainId")
  }
  return swapper
}
export const getVerifier = (chainId: number) => {
  const verifier = contractBook.swapVerifier.address[chainId] || ""
  if (!verifier) {
    throw new Error("Verifier contract not found for chainId")
  }
  return verifier
}

export function encodeERC20TransferMulticallItem(
  token: Address,
  amount: bigint,
  receiver: Address,
): SwapApiResponseMulticallItem {
  const abiItem = {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    stateMutability: "nonpayable",
    type: "function",
  }

  const functionData = encodeFunctionData({
    abi: [abiItem],
    args: [receiver, amount],
  })

  const swapData = encodeAbiParameters(parseAbiParameters("address, bytes"), [
    token,
    functionData,
  ])

  const swapMulticallItem = encodeSwapMulticallItem({
    handler: SWAPPER_HANDLER_GENERIC,
    mode: BigInt(SwapperMode.EXACT_IN),
    account: zeroAddress,
    tokenIn: token,
    tokenOut: token,
    vaultIn: zeroAddress,
    accountIn: zeroAddress,
    receiver: zeroAddress, // ignored
    amountOut: 0n, // ignored
    data: swapData,
  })

  return swapMulticallItem
}

export async function binarySearchQuote(
  swapParams: SwapParams,
  fetchQuote: (swapParams: SwapParams) => Promise<{
    quote: any
    amountTo: bigint
  }>,
  targetAmountTo: bigint,
  amountFrom: bigint,
  shouldContinue: (currentAmountTo: bigint) => boolean,
) {
  let percentageChange = 10000n // 100% no change
  let cnt = 0
  let quote
  let amountTo

  do {
    amountFrom = (amountFrom * percentageChange) / 10000n
    ;({ quote, amountTo } = await fetchQuote({
      ...swapParams,
      amount: amountFrom,
    }))

    if (amountTo === 0n || targetAmountTo === 0n)
      throw new Error("Quote not found")

    percentageChange =
      amountTo > targetAmountTo
        ? // result above target, adjust input down by the percentage difference of outputs - 0.01%
          ((amountTo - targetAmountTo) * 10_000n) / targetAmountTo + 1n - 10000n
        : // result below target, adjust input by the percentege difference of outputs + 0.01%
          ((targetAmountTo - amountTo) * 10_000n) / amountTo + 10_000n + 1n

    percentageChange =
      percentageChange < 0n ? percentageChange * -1n : percentageChange

    if (cnt++ === 15)
      throw new Error("Binary search not completed in 15 iterations")
  } while (shouldContinue(amountTo))

  return quote
}

// scale unit quote to target amount out and apply to amount in
export function calculateEstimatedAmountFrom(
  unitAmountTo: bigint,
  targetAmountTo: bigint,
  srcDecimals: number,
  dstDecimals: number,
) {
  // adjust scale to match token from
  let estimated
  if (srcDecimals > dstDecimals) {
    estimated =
      (targetAmountTo *
        parseUnits("1", dstDecimals) *
        10n ** BigInt(srcDecimals - dstDecimals)) /
      unitAmountTo
  } else {
    estimated =
      (targetAmountTo * parseUnits("1", dstDecimals)) /
      10n ** BigInt(dstDecimals - srcDecimals) /
      unitAmountTo
  }

  return estimated
}

export function quoteToRoute(quote: SwapQuote): SwapRouteItem[] {
  return [{ providerName: quote.protocol }]
}

export function isExactInRepay(swapParams: SwapParams) {
  return swapParams.swapperMode === SwapperMode.EXACT_IN && swapParams.isRepay
}
