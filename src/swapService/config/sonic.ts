import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyRepayWrapper,
} from "../strategies"
const WSTKSCUSD_SONIC = "0x9fb76f7ce5FCeAA2C42887ff441D46095E494206"
const WSTKSCETH_SONIC = "0xE8a41c62BB4d5863C6eadC96792cFE90A1f37C47"
const WOS_SONIC = "0x9F0dF7799f6FDAd409300080cfF680f5A23df4b1"
const YUSD_SONIC = "0x4772D2e014F9fC3a820C444e3313968e9a5C8121"
const SCUSD_SONIC = "0xd3DCe716f3eF535C5Ff8d041c1A41C3bd89b97aE"
const LSTRZR_SONIC = "0x67A298e5B65dB2b4616E05C3b455E017275f53cB"

const sonicConfig: ChainRoutingConfig = [
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
      tokensInOrOut: [LSTRZR_SONIC],
    },
  },
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
          "0x",
          "magpie",
          "pendle",
          "enso",
          "okx-dex",
        ],
      },
    },
    match: {
      tokensIn: [YUSD_SONIC],
    },
  },
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          // "kyberswap",
          "paraswap",
          // "odos",
          "1inch",
          "li-fi",
          // "open-ocean",
          "uniswap",
          "0x",
          "magpie",
          "pendle",
          // "enso",
          "okx-dex",
        ],
      },
    },
    match: {
      tokensInOrOut: [SCUSD_SONIC],
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
          "0x",
          "magpie",
          "pendle",
          "enso",
          "okx-dex",
        ],
      },
    },
    match: {
      excludeTokensInOrOut: [YUSD_SONIC],
    },
  },
  // FALLBACK
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [WSTKSCUSD_SONIC, WSTKSCETH_SONIC, WOS_SONIC],
    },
  },
]

export default sonicConfig
