import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators } from "../strategies"
import { globalRoutingWrappers } from "./global"

const bobRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default bobRoutingConfig
