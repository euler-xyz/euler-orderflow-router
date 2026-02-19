import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyCombinedUniswap,
  StrategyCurveLPNG,
  StrategyERC4626Wrapper,
  StrategyIdleCDOTranche,
  StrategyMidas,
  StrategyRedirectDepositWrapper,
  StrategyRedirectTransferReceiver,
  StrategyRepayWrapper,
  StrategyStrata,
} from "../strategies"

const SUSDS_MAINNET = "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd"
const WSTUSR_MAINNET = "0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055"
const RLP_MAINNET = "0x4956b52aE2fF65D74CA2d61207523288e4528f96"
const WUSDL_MAINNET = "0x7751E2F4b8ae93EF6B79d86419d42FE3295A4559"
const PT_WSTUSR_27MAR2025_MAINNET = "0xA8c8861b5ccF8CCe0ade6811CD2A7A7d3222B0B8"
const EUSDE_MAINNET = "0x90D2af7d622ca3141efA4d8f1F24d86E5974Cc8F"
const PT_TUSDE_18DEC_MAINNET = "0x1135b22d6e8FD0809392478eEDcd8c107dB6aF9D"
const IDLEAATRANCHEFASANARA_MAINNET =
  "0x45054c6753b4Bce40C5d54418DabC20b070F85bE"
const CUSDOUSDC_CURVELP_MAINNET = "0x90455bd11Ce8a67C57d467e634Dc142b8e4105Aa"

const USUAL_USD0_VAULT_MAINNET = "0xd001f0a15D272542687b2677BA627f48A4333b5d"
const SUSP_MAINNET = "0x271C616157e69A43B4977412A64183Cf110Edf16"
const SUSDF_MAINNET = "0xc8CF6D7991f15525488b2A83Df53468D682Ba4B0"
const SUSPS_MAINNET = "0x271C616157e69A43B4977412A64183Cf110Edf16"
const PUSDE_MAINNET = "0xA62B204099277762d1669d283732dCc1B3AA96CE"
const LSTRZR_MAINNET = "0xB33f4B9C6f0624EdeAE8881c97381837760D52CB"
const STCUSD_MAINNET = "0x88887bE419578051FF9F4eb6C858A951921D8888"

const PT_SRUSDE_MAINNET = "0x1Fb3C5c35D95F48e48FFC8e36bCCe5CB5f29F57c"
const PT_JRUSDE_MAINNET = "0x53F3373F0D811902405f91eB0d5cc3957887220D"
const MHYPER_USDC_VAULT_MAINNET = "0x8aFF4fe319c30475D27eC623D7d44bD5eCFe9616"
const MHYPER_USDT_VAULT_MAINNET = "0xFa827C231062FA549143dF3C1b3584a016642630"

const PT_MAPOLLO_20NOV2025_MAINNET =
  "0x8CfEd6A728017A8641a213Bd9E2Ea6183dE275E8"
const MAPOLLO_MAINNET = "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05"

const mainnetRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyRedirectTransferReceiver.name(),
  },
  // SPECIAL CASE TOKENS
  {
    strategy: StrategyIdleCDOTranche.name(),
    match: { tokensInOrOut: [IDLEAATRANCHEFASANARA_MAINNET] },
  },
  {
    strategy: StrategyCurveLPNG.name(),
    match: { tokensInOrOut: [CUSDOUSDC_CURVELP_MAINNET] },
  },
  {
    strategy: StrategyStrata.name(),
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [
        WSTUSR_MAINNET,
        SUSP_MAINNET,
        SUSDF_MAINNET,
        SUSPS_MAINNET,
        PUSDE_MAINNET,
        LSTRZR_MAINNET,
        STCUSD_MAINNET,
      ],
      excludeTokensInOrOut: [
        PT_WSTUSR_27MAR2025_MAINNET,
        PT_TUSDE_18DEC_MAINNET,
        PT_SRUSDE_MAINNET,
        PT_JRUSDE_MAINNET,
      ],
    },
  },
  {
    strategy: StrategyMidas.name(),
    match: {
      excludeTrades: [
        {
          // TODO detect PT pairs dynamically
          tokenIn: PT_MAPOLLO_20NOV2025_MAINNET,
          tokenOut: MAPOLLO_MAINNET,
        },
      ],
    },
  },
  {
    strategy: StrategyRedirectDepositWrapper.name(),
    match: {
      repayVaults: [MHYPER_USDC_VAULT_MAINNET, MHYPER_USDT_VAULT_MAINNET],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
    match: {
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyRedirectDepositWrapper.name(),
    match: {
      repayVaults: [USUAL_USD0_VAULT_MAINNET],
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
  // Binary search overswap for target  debt
  {
    strategy: StrategyAggregators.name(),
    match: {
      swapperModes: [SwapperMode.TARGET_DEBT],
    },
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [EUSDE_MAINNET],
    },
  },
]

export default mainnetRoutingConfig
