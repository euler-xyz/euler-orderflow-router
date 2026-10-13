import * as chains from "viem/chains"
import type { RoutingConfig } from "../interface"
import arbitrumRoutingConfig from "./routing/arbitrum"
import avalancheRoutingConfig from "./routing/avalanche"
import baseRoutingConfig from "./routing/base"
import berachainRoutingConfig from "./routing/berachain"
import bobRoutingConfig from "./routing/bob"
import bscRoutingConfig from "./routing/bsc"
import defaultRoutingConfig from "./routing/default"
import mainnetRoutingConfig from "./routing/mainnet"
import plasmaRoutingConfig from "./routing/plasma"
import sonicRoutingConfig from "./routing/sonic"
import unichainRoutingConfig from "./routing/unichain"

export const routingConfig: RoutingConfig = {
  [chains.mainnet.id]: mainnetRoutingConfig,
  [chains.base.id]: baseRoutingConfig,
  [chains.avalanche.id]: avalancheRoutingConfig,
  [chains.bsc.id]: bscRoutingConfig,
  [chains.arbitrum.id]: arbitrumRoutingConfig,
  [chains.berachain.id]: berachainRoutingConfig,
  [chains.bob.id]: bobRoutingConfig,
  [chains.sonic.id]: sonicRoutingConfig,
  [chains.unichain.id]: unichainRoutingConfig,
  [chains.plasma.id]: plasmaRoutingConfig,
}

export const getRoutingConfig = (chainId: number) => {
  return routingConfig[chainId] || defaultRoutingConfig
}
