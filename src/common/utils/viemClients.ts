import dotenv from "dotenv"
dotenv.config()

import {
  http,
  type Chain,
  type Client,
  type Transport,
  createClient,
  defineChain,
} from "viem"
import * as chains from "viem/chains"

export const bartio = defineChain({
  id: 8008_4,
  name: "Bartio Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Bera",
    symbol: "BERA",
  },
  blockExplorers: {
    default: {
      name: "Bartio",
      url: "https://bartio.beratrail.io/",
    },
  },
  rpcUrls: {
    default: {
      http: ["https://bartio.rpc.berachain.com/"],
    },
  },
})

export const berachain = defineChain({
  id: 80094,
  name: "Berachain",
  nativeCurrency: {
    decimals: 18,
    name: "Bera",
    symbol: "BERA",
  },
  blockExplorers: {
    default: {
      name: "berascan",
      url: "https://berascan.com/",
    },
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.berachain.com"],
    },
  },
})

const sonicnetwork = defineChain({
  id: 146,
  name: "Sonic",
  nativeCurrency: {
    decimals: 18,
    name: "Sonic",
    symbol: "S",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.soniclabs.com"],
      webSocket: ["wss://sonic-rpc.publicnode.com"],
    },
  },
  blockExplorers: {
    default: { name: "Explorer", url: "https://sonicscan.org" },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 1,
    },
  },
})

export const RPC_URLS: Record<number, string> = {
  [chains.mainnet.id]: process.env.RPC_URL_1 || "",
  [chains.sepolia.id]: process.env.RPC_URL_11155111 || "",
  [chains.arbitrum.id]: process.env.RPC_URL_42161 || "",
  [chains.base.id]: process.env.RPC_URL_8453 || "",
  [bartio.id]: process.env.RPC_URL_80084 || "",
  [berachain.id]: process.env.RPC_URL_80094 || "",
  [146]: process.env.RPC_URL_146 || "",
  [chains.foundry.id]: process.env.RPC_URL_31337 || "http://localhost:8545",
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
  [bartio.id]: createChainConfig(bartio),
  [chains.mainnet.id]: createChainConfig(chains.mainnet),
  [chains.sepolia.id]: createClient({
    chain: chains.sepolia,
    transport: http(RPC_URLS[chains.sepolia.id]),
  }),
  [chains.foundry.id]: createClient({
    chain: chains.foundry,
    transport: http(RPC_URLS[chains.foundry.id]),
  }),
  [chains.arbitrum.id]: createChainConfig(chains.arbitrum),
  [sonicnetwork.id]: createClient({
    chain: sonicnetwork,
    transport: http(RPC_URLS[sonicnetwork.id]),
  }),
  [berachain.id]: createChainConfig(berachain),
  [chains.bsc.id]: createClient({
    chain: chains.bsc,
    transport: http(RPC_URLS[chains.bsc.id]),
  }),
})

export const viemClients = createClients()
