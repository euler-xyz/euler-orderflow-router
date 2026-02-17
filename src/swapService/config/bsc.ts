import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyAggregators, StrategyRepayWrapper } from "../strategies"

const bscRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
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
