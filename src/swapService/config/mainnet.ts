import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyBalmySDK,
  StrategyCombinedUniswap,
  StrategyCurveLPNG,
  StrategyERC4626Wrapper,
  StrategyIdleCDOTranche,
  StrategyMidas,
  StrategyRedirectDepositWrapper,
  StrategyRepayWrapper,
} from "../strategies"

const SUSDS_MAINNET = "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd"
const WSTUSR_MAINNET = "0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055"
const RLP_MAINNET = "0x4956b52aE2fF65D74CA2d61207523288e4528f96"
const WUSDL_MAINNET = "0x7751E2F4b8ae93EF6B79d86419d42FE3295A4559"
const PT_WSTUSR1740182579 = "0xd0097149aa4cc0d0e1fc99b8bd73fc17dc32c1e9"
const PT_WSTUSR_27MAR2025_MAINNET = "0xA8c8861b5ccF8CCe0ade6811CD2A7A7d3222B0B8"
const YNETH_MAINNET = "0x09db87A538BD693E9d08544577d5cCfAA6373A48"
const YNETHX_MAINNET = "0x657d9aba1dbb59e53f9f3ecaa878447dcfc96dcb"
const IDLEAATRANCHEFASANARA_MAINNET =
  "0x45054c6753b4Bce40C5d54418DabC20b070F85bE"
const CUSDOUSDC_CURVELP_MAINNET = "0x90455bd11Ce8a67C57d467e634Dc142b8e4105Aa"

const USUAL_USD0_VAULT_MAINNET = "0xd001f0a15D272542687b2677BA627f48A4333b5d"

const mainnetRoutingConfig: ChainRoutingConfig = [
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
  {
    strategy: StrategyIdleCDOTranche.name(),
    match: { tokensInOrOut: [IDLEAATRANCHEFASANARA_MAINNET] },
  },
  {
    strategy: StrategyCurveLPNG.name(),
    match: { tokensInOrOut: [CUSDOUSDC_CURVELP_MAINNET] },
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [
        WSTUSR_MAINNET,
        PT_WSTUSR1740182579,
        YNETH_MAINNET,
        YNETHX_MAINNET,
      ],
      excludeTokensInOrOut: [PT_WSTUSR_27MAR2025_MAINNET],
    },
  },
  // WUSDL with paraswap
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
          "magpie",
          "0x",
        ],
      },
    },
    match: {
      tokensInOrOut: [WUSDL_MAINNET],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "kyberswap",
          // "paraswap",
          "odos",
          "1inch",
          "li-fi",
          "open-ocean",
          "magpie",
          "0x",
          "enso",
          "pendle",
        ],
      },
    },
    match: {
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyCombinedUniswap.name(),
    match: {
      swapperModes: [SwapperMode.TARGET_DEBT],
      excludeTokensInOrOut: [RLP_MAINNET, SUSDS_MAINNET, WUSDL_MAINNET],
      notPendlePT: true,
    },
  },
  // FALLBACKS
  // If exact out for Usual's USD0 repay doesn't work, over swap with deposit to escrow
  {
    strategy: StrategyRedirectDepositWrapper.name(),
    match: {
      repayVaults: [USUAL_USD0_VAULT_MAINNET],
    },
  },
  // Binary search overswap for target  debt
  {
    strategy: StrategyBalmySDK.name(),
    config: {
      sourcesFilter: {
        includeSources: [
          "kyberswap",
          // "paraswap",
          "odos",
          "1inch",
          "li-fi",
          "open-ocean",
          "magpie",
          "0x",
          "enso",
          "pendle",
        ],
      },
    },
    match: {
      swapperModes: [SwapperMode.TARGET_DEBT],
    },
  },
]

export default mainnetRoutingConfig
