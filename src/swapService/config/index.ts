import { base, mainnet } from "viem/chains"
import type { RoutingConfig } from "../interface"
import baseRoutingConfig from "./base"
import defaultRoutingConfig from "./default"
import mainnetRoutingConfig from "./mainnet"

const routingConfig: RoutingConfig = {
  [mainnet.id]: mainnetRoutingConfig,
  [base.id]: baseRoutingConfig,
}

export const getRoutingConfig = (chainId: number) => {
  return routingConfig[chainId] || defaultRoutingConfig
}
