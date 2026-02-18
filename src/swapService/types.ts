import type { TokenListItem } from "@/common/utils/tokenList"
import type { Address, Hex } from "viem"
import type {
  ChainRoutingConfig,
  SwapApiResponse,
  SwapperMode,
} from "./interface"

export interface SwapParams {
  chainId: number
  tokenIn: TokenListItem
  tokenOut: TokenListItem
  accountIn: Address
  accountOut: Address
  vaultIn: Address
  receiver: Address
  origin: Address
  swapperMode: SwapperMode
  from: Address
  amount: bigint
  targetDebt: bigint
  currentDebt: bigint
  slippage: number
  deadline: number
  isRepay: boolean
  dustAccount: Address
  routingOverride?: ChainRoutingConfig
  onlyFixedInputExactOut?: boolean // only fetch quotes where amountIn is fixed and not subject to slippage
  noRepayEncoding?: boolean // FIXME workaround for composite repays (ERC4626 strategy / overswap)
  skipSweepDepositOut?: boolean // don't add the final deposit of the bought asset (sweep), leave the assets in Swapper
  unusedInputReceiver?: Address // address to receive unused input instead of depositing to vaultIn/accountIn
  transferOutputToReceiver?: boolean // transfer output tokens to receiver instead of depositing. Invalidates accountOut
  provider?: string // preselected provider
}

export interface SwapQuote {
  swapParams: SwapParams
  amountIn: bigint
  amountInMax?: bigint
  amountOut: bigint
  amountOutMin?: bigint
  data: Hex
  protocol: string
  shouldTransferToReceiver?: boolean
  allowanceTarget?: Address
  estimatedGas?: bigint
}

export interface StrategyResult {
  strategy: string
  match: boolean
  supports: boolean
  error?: unknown
  quotes?: SwapApiResponse[]
}
