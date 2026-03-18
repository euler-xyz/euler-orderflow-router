import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators, StrategyMidas } from "../strategies"
import { globalRoutingWrappers } from "./global"

const baseRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
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
