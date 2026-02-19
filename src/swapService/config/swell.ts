import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyAggregators, StrategyRedirectTransferReceiver, StrategyRepayWrapper } from "../strategies"

const swellRoutingConfig: ChainRoutingConfig = [
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
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default swellRoutingConfig
