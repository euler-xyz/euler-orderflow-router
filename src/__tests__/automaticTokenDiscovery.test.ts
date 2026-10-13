import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 146: "https://rpc.example" },
}))
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ extend: () => ({ readContract: mocks.read }) }),
}))
const address = "0x0000000000000000000000000000000000000001"
const market = "0x0000000000000000000000000000000000000002"
const token = {
  chainId: 146,
  address,
  name: "Listed",
  symbol: "TOK",
  decimals: 18,
  logoURI: "",
  metadata: { isPendlePT: true },
}
const response = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(() => {
  vi.resetModules()
  mocks.read.mockReset()
  vi.stubEnv("TOKENLIST_URL", "https://v3.example/v3/tokens")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("v3.example"))
        return { ok: false, status: 404, statusText: "CHAIN_NOT_SUPPORTED" }
      if (url.includes("tokenlists-")) return response({ token })
      if (url.includes("unpkg.com")) return response({ tokens: [] })
      return response({
        results: [{ chainId: 146, address: market, pt: `146-${address}` }],
        total: 1,
      })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("automatic discovery with verified quote metadata", () => {
  it("uses fallback addresses, contract decimals and provider routing metadata together", async () => {
    mocks.read.mockResolvedValue(6)
    const api = await import("../common/utils/tokenList")
    await api.buildCache()
    const resolved = await api.getOrFetchToken(146, address)
    expect(resolved?.decimals).toBe(6)
    expect(resolved?.metadata).toEqual({
      isPendlePT: true,
      isPendleLP: false,
      pendleMarket: market,
    })
  })
  it("does not pass third-party decimals through when verification fails", async () => {
    mocks.read.mockRejectedValue(new Error("RPC unavailable"))
    const api = await import("../common/utils/tokenList")
    await api.buildCache()
    expect(await api.getOrFetchToken(146, address)).toBeUndefined()
  })
  it("ignores third-party protocol claims when the provider has no matching market", async () => {
    mocks.read.mockResolvedValue(6)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("tokenlists-")) return response({ token })
        if (url.includes("unpkg.com")) return response({ tokens: [] })
        if (url.includes("pendle")) return response({ results: [], total: 0 })
        return { ok: false, status: 404 }
      }),
    )
    const api = await import("../common/utils/tokenList")
    await api.buildCache()
    expect((await api.getOrFetchToken(146, address))?.metadata).toBeUndefined()
  })
  it("can discover a missing inner ERC-20 even when every list is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    )
    mocks.read.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        ({ name: "Onchain", symbol: "NEW", decimals: 8 })[
          functionName as "name" | "symbol" | "decimals"
        ],
    )
    const api = await import("../common/utils/tokenList")
    await api.buildCache()
    expect(api.getAllTokenLists()[146]).toEqual([])
    expect(await api.getOrFetchToken(146, address)).toMatchObject({
      name: "Onchain",
      decimals: 8,
    })
  })
})
