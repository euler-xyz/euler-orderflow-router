import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SUSDC_ARBITRUM = "0x940098b108fB7D0a7E374f6eDED7760787464609"

const arbitrumRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
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
