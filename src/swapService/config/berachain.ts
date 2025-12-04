import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SNECT_BERACHAIN = "0x597877Ccf65be938BD214C4c46907669e3E62128"
const BB_SNECT_BERACHAIN = "0x1d22592F66Fc92e0a64eE9300eAeca548cd466c5"

const berachainRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  // SPECIAL CASE TOKENS
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [BB_SNECT_BERACHAIN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
  // FALLBACKS
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [SNECT_BERACHAIN],
    },
  },
]

export default berachainRoutingConfig
