import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyMidas,
  StrategyRepayWrapper,
} from "../strategies"

const baseRoutingConfig: ChainRoutingConfig = [
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
    strategy: StrategyMidas.name(),
    match: {}, // supports function will match mTokens
  },
  // DEFAULTS
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "kyberswap",
          // "paraswap",
          //"odos",
          "1inch",
          "li-fi",
          "open-ocean",
          "uniswap",
          "magpie",
          "pendle",
          "enso",
        ],
      },
    },
    match: {},
  },
]

export default baseRoutingConfig
