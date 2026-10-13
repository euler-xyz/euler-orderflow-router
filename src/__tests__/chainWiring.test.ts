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

const ascending = (a: number, b: number) => a - b

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

  it("keeps each aggregator's support on the service's chains", async () => {
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
          [...new Set(metadata.supports.chains)]
            .filter((chainId) => SERVICE_CHAIN_IDS.includes(chainId))
            .sort(ascending),
        ]),
    )

    expect(support).toEqual(AGGREGATOR_SUPPORT)
  })
})
