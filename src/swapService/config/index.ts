import { arbitrum, avalanche, base, bsc, mainnet } from "viem/chains"
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
import hyperevmRoutingConfig from "./hyperevm"

export const routingConfig: RoutingConfig = {
  [mainnet.id]: mainnetRoutingConfig,
  [base.id]: baseRoutingConfig,
  [avalanche.id]: avalancheRoutingConfig,
  [bsc.id]: bscRoutingConfig,
  [arbitrum.id]: arbitrumRoutingConfig,
  [1923]: swellRoutingConfig,
  [80094]: berachainRoutingConfig,
  [60808]: bobRoutingConfig,
  [146]: sonicRoutingConfig,
  [130]: unichainRoutingConfig,
  [9745]: plasmaRoutingConfig,
  [999]: hyperevmRoutingConfig,
}

export const getRoutingConfig = (chainId: number) => {
  return routingConfig[chainId] || defaultRoutingConfig
}
