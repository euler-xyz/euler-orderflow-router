import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SUSDC_UNICHAIN = "0x14d9143BEcC348920b68D123687045db49a016C6"

const unichainRoutingConfig: ChainRoutingConfig = [
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
      tokensInOrOut: [SUSDC_UNICHAIN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "kyberswap",
          "li-fi",
          "open-ocean",
          "uniswap",
          "enso",
          "okx-dex",
          "magpie",
          "paraswap",
          "odos",
          "0x",
        ],
      },
    },
    match: {},
  },
]

export default unichainRoutingConfig
