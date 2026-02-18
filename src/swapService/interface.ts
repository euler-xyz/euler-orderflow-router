import type { TokenListItem } from "@/common/utils/tokenList"
import type { Address, Hex } from "viem"

export interface SwapApiRequest {
  tokenIn: Address
  tokenOut: Address
  accountIn: Address
  accountOut: Address
  amount: bigint // exact in - amount to sell, exact out - amount to buy, exact out repay - estimated amount to buy (from current debt)
  vaultIn: Address // for returning unused input
  receiver: Address // vault to swap or repay to
  origin: Address // EOA sending the tx
  slippage: number // in percent 1 = 1%
  swapperMode: SwapperMode
  isRepay: boolean
  targetDebt: bigint // ignored if not in target debt mode
  currentDebt: bigint // needed in exact input or output and with `isRepay` set
  deadline: number // timestamp in seconds
  dustAccount?: Address // dust will be deposited for this account or to `accountOut` if not provided
  routingOverride?: RoutingConfig
}

export interface SwapApiResponse {
  amountIn: string
  amountInMax: string
  amountOut: string
  amountOutMin: string
  accountIn: Address
  accountOut: Address
  vaultIn: Address
  receiver: Address
  tokenIn: TokenListItem
  tokenOut: TokenListItem
  slippage: number // actual slippage, mtBILL to USDC overwrite to 0 slippage
  swap: SwapApiResponseSwap
  verify: SwapApiResponseVerify
  route: SwapRouteItem[]
  estimatedGas?: string
  transferOutputToReceiver?: boolean
}

export interface SwapApiResponseSwap {
  swapperAddress: Address
  swapperData: Hex // multicall calldata
  multicallItems: SwapApiResponseMulticallItem[]
}

export interface SwapApiResponseVerify {
  verifierAddress: Address
  verifierData: Hex // verifier calldata
  type: SwapVerificationType
  vault: Address
  account: Address
  amount: string
  deadline: number
}

export interface SwapApiResponseMulticallItem {
  functionName: string
  args: any
  data: Hex // Swapper function calldata
}

export enum SwapVerificationType {
  SkimMin = "skimMin",
  DebtMax = "debtMax",
  TransferMin = "transferMin",
}

export type StrategyConfig = any // TODO

export interface StrategyMatchConfig {
  swapperModes?: SwapperMode[]
  isRepay?: boolean
  isPendlePT?: boolean
  notPendlePT?: boolean
  tokensInOrOut?: Address[]
  tokensIn?: Address[]
  excludeTokensInOrOut?: Address[]
  repayVaults?: Address[]
  trades?: {
    tokenIn: Address
    tokenOut: Address
  }[]
  excludeTrades?: {
    tokenIn: Address
    tokenOut: Address
  }[]
}

export interface RoutingItem {
  strategy: string
  match?: StrategyMatchConfig
  config?: StrategyConfig
}

export interface SwapRouteItem {
  providerName: string
}

export enum SwapperMode {
  // 0 - exact input swap
  EXACT_IN = 0,
  // 1 - exact output swap
  EXACT_OUT = 1,
  // 2 - exact output swap and repay, targeting a debt amount of an account
  TARGET_DEBT = 2,
}

export type ChainRoutingConfig = RoutingItem[]

export type RoutingConfig = Record<string, ChainRoutingConfig>
