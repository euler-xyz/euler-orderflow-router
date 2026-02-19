import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyElixir,
  StrategyMidas,
  StrategyPendleLP,
  StrategyRedirectDepositWrapper,
  StrategyRedirectTransferReceiver,
  StrategyRepayWrapper,
} from "../strategies"

const ELIXIR_USDT_VAULT = "0x3799251bD81925cfcCF2992F10Af27A4e62Bf3F7"
const TELOSC_MSUSD_VAULT_PLASMA = "0xF90Cf999dE728A582e154F926876b70e93a747B7"
const TELOSC_PLUSD_VAULT_PLASMA = "0x27934d4879fc28a74703726eDae15F757E45A48a"
const SDEUSD_PLASMA = "0x7884A8457f0E63e82C89A87fE48E8Ba8223DB069"

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
    strategy: StrategyRedirectTransferReceiver.name(),
  },
  {
    strategy: StrategyRedirectDepositWrapper.name(),
    match: {
      repayVaults: [
        ELIXIR_USDT_VAULT,
        TELOSC_MSUSD_VAULT_PLASMA,
        TELOSC_PLUSD_VAULT_PLASMA,
      ],
    },
  },
  {
    strategy: StrategyElixir.name(),
    match: {
      tokensInOrOut: [SDEUSD_PLASMA],
    },
  },
  {
    strategy: StrategyMidas.name(),
  },
  {
    strategy: StrategyPendleLP.name(),
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default plasmaRoutingConfig
