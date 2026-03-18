import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators } from "../strategies"
import { globalRoutingWrappers } from "./global"

const bscRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  // {
  //   strategy: StrategyERC4626Wrapper.name(),
  //   match: {
  //     tokensInOrOut: [YNBNBX_BSC],
  //   },
  // },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default bscRoutingConfig
