import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const YNBNBX_BSC = "0x32C830f5c34122C6afB8aE87ABA541B7900a2C5F"

const bscRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [YNBNBX_BSC],
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
