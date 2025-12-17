import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyRepayWrapper,
} from "../strategies"


const hyperevmRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "enso",
        ],
      },
    },
    match: {
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  // FALLBACKS
  // Binary search overswap for target  debt
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "enso",
        ],
      },
    },
    match: {
      swapperModes: [SwapperMode.TARGET_DEBT],
    },
  },
]


export default hyperevmRoutingConfig
