import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyMidas,
  StrategyRepayWrapper,
} from "../strategies"
// const YOUSD_BASE = "0x0000000f2eB9f69274678c76222B35eEc7588a65"
// const YOETH_BASE = "0x3A43AEC53490CB9Fa922847385D82fe25d0E9De7"
// const YOBTC_BASE = "0xbCbc8cb4D1e8ED048a6276a5E94A3e952660BcbC"

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
  // {
  //   strategy: StrategyERC4626Wrapper.name(),
  //   match: {
  //     tokensInOrOut: [YOUSD_BASE, YOETH_BASE, YOBTC_BASE],
  //   },
  // },
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
