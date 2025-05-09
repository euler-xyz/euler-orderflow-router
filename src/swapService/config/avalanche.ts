import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SAVUSD_AVALANCHE = "0x06d47F3fb376649c3A9Dafe069B3D6E35572219E"
// const SDEUSD_AVALANCHE = "0x68088C91446c7bEa49ea7Dbd3B96Ce62B272DC96"

const avalancheRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  // SPECIAL CASE
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [SAVUSD_AVALANCHE],
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
        ],
      },
    },
    match: {},
  },
]

export default avalancheRoutingConfig
