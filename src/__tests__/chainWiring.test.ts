import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildFetchService } from "@balmy/sdk/dist/sdk/builders/fetch-builder"
import { buildProviderService } from "@balmy/sdk/dist/sdk/builders/provider-builder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const SERVICE_CHAIN_IDS = [
  1, 56, 130, 143, 146, 239, 999, 8453, 9745, 42161, 43114, 59144, 60808, 80094,
]

const AGGREGATOR_SUPPORT: Record<string, number[]> = {
  "0x": [1, 56, 130, 8453, 9745, 42161, 43114, 59144],
  "1inch": [1, 56, 8453, 42161, 43114],
  "binance-wallet": [1, 56, 8453, 42161, 43114],
  enso: [1, 56, 130, 143, 146, 999, 8453, 9745, 42161, 43114, 80094],
  kyberswap: [1, 56, 130, 143, 146, 999, 8453, 9745, 42161, 43114, 59144],
  "li-fi": [1, 56, 130, 999, 8453, 42161, 43114, 59144, 80094],
  magpie: [1, 56, 130, 143, 146, 8453, 9745, 42161, 43114, 80094],
  multiliquid: [1],
  nordstern: [
    1, 56, 130, 143, 146, 239, 999, 8453, 9745, 42161, 43114, 59144, 60808,
    80094,
  ],
  "okx-dex": [1, 56, 130, 146, 8453, 9745, 42161, 43114, 59144],
  oku_bob_icecreamswap: [60808],
  oku_bob_uniswap: [60808],
  oogabooga: [80094],
  "open-ocean": [
    1, 56, 130, 143, 146, 239, 999, 8453, 9745, 42161, 43114, 59144, 80094,
  ],
  paraswap: [1, 56, 130, 8453, 42161, 43114],
  spectra: [1, 56, 146, 999, 8453, 42161, 43114],
  uniswap: [1, 56, 130, 8453, 42161, 43114],
}

const AGGREGATOR_SETTINGS = {
  kyberswap: {
    1: { chainKey: "ethereum" },
    56: { chainKey: "bsc" },
    130: { chainKey: "unichain" },
    143: { chainKey: "monad" },
    146: { chainKey: "sonic" },
    999: { chainKey: "hyperevm" },
    8453: { chainKey: "base" },
    9745: { chainKey: "plasma" },
    42161: { chainKey: "arbitrum" },
    43114: { chainKey: "avalanche" },
    59144: { chainKey: "linea" },
  },
  magpie: {
    1: { network: "ethereum" },
    56: { network: "bsc" },
    130: { network: "unichain" },
    143: { network: "monad" },
    146: { network: "sonic" },
    8453: { network: "base" },
    9745: { network: "plasma" },
    42161: { network: "arbitrum" },
    43114: { network: "avalanche" },
    80094: { network: "berachain" },
  },
  oku: {
    60808: {
      chainKey: "bob",
      permit2Adapter: "0x867c17C297083cD7d73B39C89e4602878C4Caa65",
    },
  },
  "open-ocean": {
    1: true,
    56: true,
    130: true,
    143: true,
    146: true,
    239: true,
    999: {
      nativeAsset: "0x0000000000000000000000000000000000000000",
    },
    8453: true,
    9745: true,
    42161: true,
    43114: {
      nativeAsset: "0x0000000000000000000000000000000000000000",
    },
    59144: true,
    80094: true,
  },
  spectra: {
    1: { network: "mainnet" },
    56: { network: "bsc" },
    146: { network: "sonic" },
    999: { network: "hyperevm" },
    8453: { network: "base" },
    42161: { network: "arbitrum" },
    43114: { network: "avalanche" },
  },
  uniswap: {
    1: { router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
    56: { router: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2" },
    130: { router: "0x73855d06de49d0fe4a9c42636ba96c62da12ff9c" },
    8453: { router: "0x2626664c2603336E57B271c5C0b26F421741e481" },
    42161: { router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
    43114: { router: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE" },
  },
} as const

const ascending = (a: number, b: number) => a - b

const rpcEnvNamesIn = (envTemplate: string) =>
  [...envTemplate.matchAll(/^(RPC_URL_\d+)=/gm)].map(([, name]) => name)

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("chain wiring", () => {
  it("reads each chain's RPC from RPC_URL_<chainId>", async () => {
    for (const chainId of SERVICE_CHAIN_IDS) {
      vi.stubEnv(`RPC_URL_${chainId}`, `https://rpc-${chainId}.example`)
    }
    const { RPC_URLS } = await import("../common/utils/viemClients")

    expect(RPC_URLS).toEqual(
      Object.fromEntries(
        SERVICE_CHAIN_IDS.map((chainId) => [
          chainId,
          `https://rpc-${chainId}.example`,
        ]),
      ),
    )
  })

  it("registers each chain once", async () => {
    const { chainConfigs } = await import("../swapService/config/chains")
    const chainIds = chainConfigs.map(({ chain }) => chain.id)

    expect(new Set(chainIds).size).toBe(chainIds.length)
    expect([...chainIds].sort(ascending)).toEqual(SERVICE_CHAIN_IDS)
  })

  it("creates a viem client for every configured chain", async () => {
    const { createClients } = await import("../common/utils/viemClients")
    const clients = createClients()

    expect(Object.keys(clients).map(Number).sort(ascending)).toEqual(
      SERVICE_CHAIN_IDS,
    )
    for (const [chainId, client] of Object.entries(clients)) {
      expect(client.chain.id).toBe(Number(chainId))
    }
  })

  it("lists exactly the derived RPC env names in .env.template", async () => {
    const { chainConfigs, rpcUrlEnvName } = await import(
      "../swapService/config/chains"
    )
    const envTemplate = readFileSync(
      resolve(__dirname, "../../.env.template"),
      "utf8",
    )
    const listed = rpcEnvNamesIn(envTemplate)

    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(
      chainConfigs.map(({ chain }) => rpcUrlEnvName(chain.id)).sort(),
    )
  })

  it("keeps each aggregator's per-chain settings", async () => {
    const { aggregatorChainSettings } = await import(
      "../swapService/config/chains"
    )

    for (const [aggregator, settings] of Object.entries(AGGREGATOR_SETTINGS)) {
      expect(
        aggregatorChainSettings(aggregator as keyof typeof AGGREGATOR_SETTINGS),
      ).toEqual(settings)
    }
  })

  it("supports each aggregator on exactly the chains that enable it", async () => {
    const { CustomSourceList } = await import(
      "../swapService/strategies/aggregators/customSourceList"
    )
    const sources = new CustomSourceList({
      providerService: buildProviderService(),
      fetchService: buildFetchService(),
    }).supportedSources()

    // Pendle sources follow pendleAggregators.json, regenerated at image build.
    const support = Object.fromEntries(
      Object.entries<{ supports: { chains: number[] } }>(sources)
        .filter(([sourceId]) => !sourceId.startsWith("pendle-"))
        .map(([sourceId, metadata]) => [
          sourceId,
          [...metadata.supports.chains].sort(ascending),
        ]),
    )

    expect(support).toEqual(AGGREGATOR_SUPPORT)
  })
})
