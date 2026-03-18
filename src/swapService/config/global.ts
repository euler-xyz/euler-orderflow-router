import { type ChainRoutingConfig, SwapperMode } from "../interface"
import {
  StrategyRedirectTransferReceiver,
  StrategyRepayWrapper,
} from "../strategies"

export const globalRoutingWrappers: ChainRoutingConfig = [
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
]
