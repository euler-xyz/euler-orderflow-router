import dotenv from "dotenv"
dotenv.config()

import {
  http,
  type Chain,
  type Client,
  type Transport,
  createClient,
} from "viem"
import * as chains from "viem/chains"

export const SUPPORTED_CHAINS = [
  chains.mainnet,
  chains.arbitrum,
  chains.base,
  chains.berachain,
  chains.avalanche,
  chains.bsc,
  chains.linea,
  chains.sonic,
  chains.hyperEvm,
  chains.unichain,
  chains.bob,
  chains.tac,
  chains.plasma,
  chains.monad,
] as const satisfies readonly Chain[]

export const RPC_URLS: Record<number, string> = Object.fromEntries(
  SUPPORTED_CHAINS.map(({ id }) => [id, process.env[`RPC_URL_${id}`] || ""]),
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
    SUPPORTED_CHAINS.map((chain) => [chain.id, createChainConfig(chain)]),
  )

export const viemClients = createClients()
