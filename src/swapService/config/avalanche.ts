import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyAggregators,
  StrategyERC4626Wrapper,
  StrategyElixir,
  StrategyRepayWrapper,
} from "../strategies"

// const SAVUSD_AVALANCHE = "a0x06d47F3fb376649c3A9Dafe069B3D6E35572219E"
const SDEUSD_AVALANCHE = "0x68088C91446c7bEa49ea7Dbd3B96Ce62B272DC96"
const XUSDC_AVALANCHE = "0xA39986F96B80d04e8d7AeAaF47175F47C23FD0f4"

const avalancheRoutingConfig: ChainRoutingConfig = [
  // WRAPPERS
  {
    strategy: StrategyRepayWrapper.name(),
    match: {
      isRepay: true,
      swapperModes: [SwapperMode.EXACT_IN],
    },
  },
  {
    strategy: StrategyElixir.name(),
    match: {
      tokensInOrOut: [SDEUSD_AVALANCHE],
    },
  },
  {
    strategy: StrategyERC4626Wrapper.name(),
    match: {
      tokensInOrOut: [XUSDC_AVALANCHE],
    },
  },
  // DEFAULTS
  {
    strategy: StrategyAggregators.name(),
  },
]

export default avalancheRoutingConfig
