import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators } from "../strategies"
import { globalRoutingWrappers } from "./global"

const defaultRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default defaultRoutingConfig
