import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyBalmySDK, StrategyRepayWrapper } from "../strategies"

const swellRoutingConfig: ChainRoutingConfig = [
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
        includeSources: ["neptune", "li-fi", "open-ocean"],
      },
    },
    match: {},
  },
]

export default swellRoutingConfig
