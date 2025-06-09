import { avalanche, base, bsc, mainnet } from "viem/chains"
import type { RoutingConfig } from "../interface"
import avalancheRoutingConfig from "./avalanche"
import baseRoutingConfig from "./base"
import berachainRoutingConfig from "./berachain"
import bobRoutingConfig from "./bob"
import bscRoutingConfig from "./bsc"
import defaultRoutingConfig from "./default"
import mainnetRoutingConfig from "./mainnet"
import sonicRoutingConfig from "./sonic"
import swellRoutingConfig from "./swell"
import unichainRoutingConfig from "./unichain"

const routingConfig: RoutingConfig = {
  [mainnet.id]: mainnetRoutingConfig,
  [base.id]: baseRoutingConfig,
  [avalanche.id]: avalancheRoutingConfig,
  [bsc.id]: bscRoutingConfig,
  [1923]: swellRoutingConfig,
  [80094]: berachainRoutingConfig,
  [60808]: bobRoutingConfig,
  [146]: sonicRoutingConfig,
  [130]: unichainRoutingConfig,
}

export const getRoutingConfig = (chainId: number) => {
  return routingConfig[chainId] || defaultRoutingConfig
}
