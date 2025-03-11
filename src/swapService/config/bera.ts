import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyBalmySDK, StrategyRepayWrapper } from "../strategies"

const beraRoutingConfig: ChainRoutingConfig = [
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
        includeSources: ["oogabooga", "li-fi", "magpie", "open-ocean"],
      },
    },
    match: {},
  },
]

export default beraRoutingConfig
