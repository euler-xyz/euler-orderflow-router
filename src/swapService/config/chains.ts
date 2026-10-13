import arbitrum from "./arbitrum"
import avalanche from "./avalanche"
import base from "./base"
import berachain from "./berachain"
import bob from "./bob"
import bsc from "./bsc"
import type {
  AggregatorChainSettings,
  AggregatorId,
  ChainConfig,
} from "./chainConfig"
import hyperevm from "./hyperevm"
import linea from "./linea"
import mainnet from "./mainnet"
import monad from "./monad"
import plasma from "./plasma"
import sonic from "./sonic"
import tac from "./tac"
import unichain from "./unichain"

// Leaf module: viemClients and the aggregator sources read it at load time, so
// it must not import routing or strategies.
export const chainConfigs: readonly ChainConfig[] = [
  mainnet,
  arbitrum,
  avalanche,
  base,
  berachain,
  bob,
  bsc,
  hyperevm,
  linea,
  monad,
  plasma,
  sonic,
  tac,
  unichain,
]

export const rpcUrlEnvName = (chainId: number) => `RPC_URL_${chainId}`

export function aggregatorChainSettings<Id extends AggregatorId>(
  aggregator: Id,
): Record<number, AggregatorChainSettings[Id]> {
  return Object.fromEntries(
    chainConfigs.flatMap(({ chain, aggregators }) => {
      const settings = aggregators[aggregator]
      return settings === undefined ? [] : [[chain.id, settings]]
    }),
  )
}

export const aggregatorChains = (aggregator: AggregatorId): number[] =>
  Object.keys(aggregatorChainSettings(aggregator)).map(Number)
