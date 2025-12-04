import * as chains from "viem/chains"
import type { RoutingConfig } from "../interface"
import arbitrumRoutingConfig from "./arbitrum"
import avalancheRoutingConfig from "./avalanche"
import baseRoutingConfig from "./base"
import berachainRoutingConfig from "./berachain"
import bobRoutingConfig from "./bob"
import bscRoutingConfig from "./bsc"
import defaultRoutingConfig from "./default"
import mainnetRoutingConfig from "./mainnet"
import plasmaRoutingConfig from "./plasma"
import sonicRoutingConfig from "./sonic"
import swellRoutingConfig from "./swell"
import unichainRoutingConfig from "./unichain"

export const routingConfig: RoutingConfig = {
  [chains.mainnet.id]: mainnetRoutingConfig,
  [chains.base.id]: baseRoutingConfig,
  [chains.avalanche.id]: avalancheRoutingConfig,
  [chains.bsc.id]: bscRoutingConfig,
  [chains.arbitrum.id]: arbitrumRoutingConfig,
  [chains.swellchain.id]: swellRoutingConfig,
  [chains.berachain.id]: berachainRoutingConfig,
  [chains.bob.id]: bobRoutingConfig,
  [chains.sonic.id]: sonicRoutingConfig,
  [chains.unichain.id]: unichainRoutingConfig,
  [chains.plasma.id]: plasmaRoutingConfig,
}

export const getRoutingConfig = (chainId: number) => {
  return routingConfig[chainId] || defaultRoutingConfig
}
