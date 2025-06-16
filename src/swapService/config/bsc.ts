import { type ChainRoutingConfig, SwapperMode } from "../interface"
import { StrategyBalmySDK, StrategyRepayWrapper } from "../strategies"

const bscRoutingConfig: ChainRoutingConfig = [
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
          "kyberswap",
          "paraswap",
          "odos",
          "1inch",
          "li-fi",
          "open-ocean",
          "uniswap",
          "oku",
          "magpie",
          "enso",
          "pendle",
          "okx-dex",
        ],
      },
    },
    match: {},
  },
]

export default bscRoutingConfig
