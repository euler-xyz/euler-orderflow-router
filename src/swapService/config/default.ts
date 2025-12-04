import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyAggregators, StrategyRepayWrapper } from "../strategies"

const defaultRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default defaultRoutingConfig
