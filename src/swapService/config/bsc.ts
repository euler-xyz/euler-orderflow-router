import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators, StrategyCowSwap } from "../strategies"
import { globalRoutingWrappers } from "./global"

const bscRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  // DEFAULTS
  {
    strategy: StrategyCowSwap.name(),
  },
  {
    strategy: StrategyAggregators.name(),
  },
]

export default bscRoutingConfig
