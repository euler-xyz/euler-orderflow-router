import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildFetchService } from "@balmy/sdk/dist/sdk/builders/fetch-builder"
import { buildProviderService } from "@balmy/sdk/dist/sdk/builders/provider-builder"
import { defineChain } from "viem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AggregatorId,
  ChainConfig,
} from "../swapService/config/chainConfig"

const ascending = (a: number, b: number) => a - b

const rpcEnvNamesIn = (envTemplate: string) =>
  [...envTemplate.matchAll(/^(RPC_URL_\d+)=/gm)].map(([, name]) => name)

const rpcUrlFor = (chainId: number) => `https://rpc-${chainId}.example`

const configuredChainIds = async () => {
  const { chainConfigs } = await import("../swapService/config/chains")
  return chainConfigs.map(({ chain }) => chain.id)
}

const syntheticChainConfig = (
  id: number,
  aggregators: ChainConfig["aggregators"],
): ChainConfig => ({
  chain: defineChain({
    id,
    name: `Synthetic ${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrlFor(id)] } },
  }),
  aggregators,
})

const aggregatorOfSource = (sourceId: string) =>
  (sourceId.startsWith("oku_") ? "oku" : sourceId) as AggregatorId

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("chain wiring", () => {
  it("reads each chain's RPC from its own RPC_URL_<chainId>", async () => {
    const chainIds = await configuredChainIds()
    const unregisteredChainId = Math.max(...chainIds) + 1
    for (const chainId of [...chainIds, unregisteredChainId]) {
      vi.stubEnv(`RPC_URL_${chainId}`, rpcUrlFor(chainId))
    }
    const { RPC_URLS } = await import("../common/utils/viemClients")

    expect(RPC_URLS).toEqual(
      Object.fromEntries(
        chainIds.map((chainId) => [chainId, rpcUrlFor(chainId)]),
      ),
    )
  })

  it("leaves a chain's RPC empty when RPC_URL_<chainId> is empty", async () => {
    const chainIds = await configuredChainIds()
    for (const chainId of chainIds) {
      vi.stubEnv(`RPC_URL_${chainId}`, "")
    }
    const { RPC_URLS } = await import("../common/utils/viemClients")

    expect(RPC_URLS).toEqual(
      Object.fromEntries(chainIds.map((chainId) => [chainId, ""])),
    )
  })

  it("registers each chain once", async () => {
    const chainIds = await configuredChainIds()

    expect(new Set(chainIds).size).toBe(chainIds.length)
  })

  it("creates a viem client for every configured chain", async () => {
    const chainIds = await configuredChainIds()
    const { createClients } = await import("../common/utils/viemClients")
    const clients = createClients()

    expect(Object.keys(clients).map(Number).toSorted(ascending)).toEqual(
      chainIds.toSorted(ascending),
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
    expect(listed.toSorted()).toEqual(
      chainConfigs.map(({ chain }) => rpcUrlEnvName(chain.id)).toSorted(),
    )
  })

  it("collects an aggregator's settings from the chains that enable it", async () => {
    const { aggregatorChainSettings, aggregatorChains } = await import(
      "../swapService/config/chains"
    )
    const configs = [
      syntheticChainConfig(900001, {
        kyberswap: { chainKey: "first" },
        nordstern: true,
      }),
      syntheticChainConfig(900002, { nordstern: true }),
      syntheticChainConfig(900003, { kyberswap: { chainKey: "third" } }),
    ]

    expect(aggregatorChainSettings("kyberswap", configs)).toEqual({
      900001: { chainKey: "first" },
      900003: { chainKey: "third" },
    })
    expect(aggregatorChains("nordstern", configs).toSorted(ascending)).toEqual([
      900001, 900002,
    ])
    expect(aggregatorChains("uniswap", configs)).toEqual([])
  })

  it("supports each aggregator on exactly the chains that enable it", async () => {
    const { aggregatorChains } = await import("../swapService/config/chains")
    const { CustomSourceList } = await import(
      "../swapService/strategies/aggregators/customSourceList"
    )
    const sources = new CustomSourceList({
      providerService: buildProviderService(),
      fetchService: buildFetchService(),
    }).supportedSources()

    // Pendle sources follow pendleAggregators.json, regenerated at image build.
    const configSources = Object.entries<{ supports: { chains: number[] } }>(
      sources,
    ).filter(([sourceId]) => !sourceId.startsWith("pendle-"))

    for (const [sourceId, metadata] of configSources) {
      expect(metadata.supports.chains.toSorted(ascending), sourceId).toEqual(
        aggregatorChains(aggregatorOfSource(sourceId)).toSorted(ascending),
      )
    }
  })
})
