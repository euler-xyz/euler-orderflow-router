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

export const RPC_URLS: Record<number, string> = {
  [chains.mainnet.id]: process.env.RPC_URL_1 || "",
  [chains.arbitrum.id]: process.env.RPC_URL_42161 || "",
  [chains.base.id]: process.env.RPC_URL_8453 || "",
  [chains.berachain.id]: process.env.RPC_URL_80094 || "",
  [chains.avalanche.id]: process.env.RPC_URL_43114 || "",
  [chains.bsc.id]: process.env.RPC_URL_56 || "",
  [chains.linea.id]: process.env.RPC_URL_56 || "",
  [chains.sonic.id]: process.env.RPC_URL_146 || "",
  [chains.unichain.id]: process.env.RPC_URL_130 || "",
  [chains.bob.id]: process.env.RPC_URL_130 || "",
  [chains.swellchain.id]: process.env.RPC_URL_130 || "",
  [chains.tac.id]: process.env.RPC_URL_239 || "",
  [chains.plasma.id]: process.env.RPC_URL_9745 || "",
  [chains.monad.id]: process.env.RPC_URL_143 || "",
} as const

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

export const createClients = (): Record<number, Client<Transport, Chain>> => ({
  [chains.mainnet.id]: createChainConfig(chains.mainnet),
  [chains.arbitrum.id]: createChainConfig(chains.arbitrum),
  [chains.base.id]: createChainConfig(chains.base),
  [chains.sonic.id]: createChainConfig(chains.sonic),
  [chains.berachain.id]: createChainConfig(chains.berachain),
  [chains.bsc.id]: createChainConfig(chains.bsc),
  [chains.avalanche.id]: createChainConfig(chains.avalanche),
  [chains.unichain.id]: createChainConfig(chains.unichain),
  [chains.tac.id]: createChainConfig(chains.tac),
  [chains.plasma.id]: createChainConfig(chains.plasma),
  [chains.linea.id]: createChainConfig(chains.linea),
})

export const viemClients = createClients()
