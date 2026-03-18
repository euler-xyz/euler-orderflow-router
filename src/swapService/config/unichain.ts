import type { ChainRoutingConfig } from "../interface"
import { StrategyAggregators, StrategyERC4626Wrapper } from "../strategies"
import { globalRoutingWrappers } from "./global"

const SUSDC_UNICHAIN = "0x14d9143BEcC348920b68D123687045db49a016C6"

const unichainRoutingConfig: ChainRoutingConfig = [
  ...globalRoutingWrappers,
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [SUSDC_UNICHAIN],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default unichainRoutingConfig
