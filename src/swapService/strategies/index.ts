import { StrategyBalmySDK } from "./strategyBalmySDK"
import { StrategyCombinedUniswap } from "./strategyCombinedUniswap"
import { StrategyConnect2 } from "./strategyConnect2"
import { StrategyCurveLPNG } from "./strategyCurveLPNG"
import { StrategyERC4626Wrapper } from "./strategyERC4626Wrapper"
import { StrategyIdleCDOTranche } from "./strategyIdleCDOTranche"
import { StrategyMidas } from "./strategyMidas"
import { StrategyRedirectDepositWrapper } from "./strategyRedirectDepositWrapper"
import { StrategyRepayWrapper } from "./strategyRepayWrapper"

export {
  StrategyCombinedUniswap,
  StrategyMidas,
  StrategyRepayWrapper,
  StrategyBalmySDK,
  StrategyERC4626Wrapper,
  StrategyIdleCDOTranche,
  StrategyCurveLPNG,
  StrategyRedirectDepositWrapper,
  StrategyConnect2,
}

export const strategies = {
  [StrategyMidas.name()]: StrategyMidas,
  [StrategyCombinedUniswap.name()]: StrategyCombinedUniswap,
  [StrategyRepayWrapper.name()]: StrategyRepayWrapper,
  [StrategyBalmySDK.name()]: StrategyBalmySDK,
  [StrategyERC4626Wrapper.name()]: StrategyERC4626Wrapper,
  [StrategyIdleCDOTranche.name()]: StrategyIdleCDOTranche,
  [StrategyCurveLPNG.name()]: StrategyCurveLPNG,
  [StrategyRedirectDepositWrapper.name()]: StrategyRedirectDepositWrapper,
  [StrategyConnect2.name()]: StrategyConnect2,
}
