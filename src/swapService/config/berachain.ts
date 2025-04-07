import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SNECT_BERACHAIN = "0x597877Ccf65be938BD214C4c46907669e3E62128"

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
      tokensInOrOut: [SNECT_BERACHAIN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: ["oogabooga", "li-fi", "magpie", "open-ocean"],
      },
    },
    match: {},
  },
]

export default berachainRoutingConfig
