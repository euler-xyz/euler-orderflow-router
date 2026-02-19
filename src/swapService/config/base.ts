import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyMidas,
  StrategyRedirectTransferReceiver,
  StrategyRepayWrapper,
} from "../strategies"

const baseRoutingConfig: ChainRoutingConfig = [
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
  // SPECIAL CASE TOKENS
  {
    strategy: StrategyMidas.name(),
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default baseRoutingConfig
