import dotenv from "dotenv"
dotenv.config()

import { chainConfigs, rpcUrlEnvName } from "@/swapService/config/chains"
import {
  http,
  type Chain,
  type Client,
  type Transport,
  createClient,
} from "viem"

export const RPC_URLS: Record<number, string> = Object.fromEntries(
  chainConfigs.map(({ chain }) => [
    chain.id,
    process.env[rpcUrlEnvName(chain.id)] || "",
  ]),
)

export const createHttp = (chainId: number) =>
  http(RPC_URLS[chainId], {
    timeout: 120_000,
    // fetchOptions: { cache: "no-store" },
  })

export function createChainConfig(chain: Chain) {
  return createClient({
    chain,
    transport: createHttp(chain.id),
  })
}

export const createClients = (): Record<number, Client<Transport, Chain>> =>
  Object.fromEntries(
    chainConfigs.map(({ chain }) => [chain.id, createChainConfig(chain)]),
  )

export const viemClients = createClients()
