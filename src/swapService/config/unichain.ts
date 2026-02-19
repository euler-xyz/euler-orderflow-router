import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyERC4626Wrapper,
  StrategyRedirectTransferReceiver,
  StrategyRepayWrapper,
} from "../strategies"

const SUSDC_UNICHAIN = "0x14d9143BEcC348920b68D123687045db49a016C6"

const unichainRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyRedirectTransferReceiver.name(),
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [SUSDC_UNICHAIN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default unichainRoutingConfig
