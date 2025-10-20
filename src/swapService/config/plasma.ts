import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyMidas,
  StrategyPendleLP,
  StrategyRepayWrapper,
} from "../strategies"

const plasmaRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyMidas.name(),
    match: {}, // supports function will match mTokens
  },
  {
    strategy: StrategyPendleLP.name(),
    match: {}, // supports function will match Pendle LP
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
          "okx-dex",
          "pendle",
          "pendle-lp",
          "0x",
        ],
      },
    },
    match: {},
  },
]

export default plasmaRoutingConfig
