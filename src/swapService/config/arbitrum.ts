import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators, StrategyERC4626Wrapper } from "../strategies"
import { globalRoutingWrappers } from "./global"

const SUSDC_ARBITRUM = "0x940098b108fB7D0a7E374f6eDED7760787464609"

const arbitrumRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [SUSDC_ARBITRUM],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default arbitrumRoutingConfig
