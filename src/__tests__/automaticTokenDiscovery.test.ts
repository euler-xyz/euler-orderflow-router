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
      if (url.includes("/assets/all")) return response({ assets: [] })
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
  it("ignores third-party protocol claims when the provider has no matching PT", async () => {
    mocks.read.mockResolvedValue(6)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("tokenlists-")) return response({ token })
        if (url.includes("unpkg.com")) return response({ tokens: [] })
        if (url.includes("/assets/all")) return response({ assets: [] })
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

describe("Sonic PTs absent from the market catalog", () => {
  const pts = [
    {
      symbol: "PT-wstkscETH-18DEC2025",
      address: "0x7e52f587f5b870d4c2cac8559ac4c49742d31a28",
      decimals: 18,
      underlying: "0x455d5f11fea33a8fa9d3e285930b478b6bf85265",
    },
    {
      symbol: "PT-wstkscUSD-18DEC2025",
      address: "0x0fb682c9692addcc1769f4d4d938c54420d54fa3",
      decimals: 6,
      underlying: "0x4d85ba8c3918359c78ed09581e5bc7578ba932ba",
    },
    {
      symbol: "PT-stS-18DEC2025",
      address: "0xe2bc30a4896ff4c52adcb180213666d2d6b21c6d",
      decimals: 18,
      underlying: "0xe5da20f15420ad15de0fa650600afc998bbe3955",
    },
  ] as const

  it.each(
    pts.flatMap((pt) => [
      { ...pt, marketsAvailable: true },
      { ...pt, marketsAvailable: false },
    ]),
  )(
    "quotes $symbol using authoritative assets with marketsAvailable=$marketsAvailable",
    async (pt) => {
      mocks.read.mockImplementation(
        async ({ functionName }: { functionName: string }) =>
          ({ name: pt.symbol, symbol: pt.symbol, decimals: pt.decimals })[
            functionName as "name" | "symbol" | "decimals"
          ],
      )
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const url = new URL(input)
          if (url.pathname === "/core/v1/assets/all") {
            expect(url.searchParams.get("chainId")).toBe("146")
            expect(url.searchParams.get("type")).toBe("PT")
            return response({ assets: [{ ...pt, chainId: 146, tags: ["PT"] }] })
          }
          if (url.pathname === "/core/v2/markets/all")
            return pt.marketsAvailable
              ? response({ results: [], total: 0 })
              : { ok: false, status: 503 }
          if (url.hostname === "unpkg.com") return response({ tokens: [] })
          if (url.pathname.includes("tokenlists-")) return response({})
          return { ok: false, status: 404 }
        }),
      )
      const api = await import("../common/utils/tokenList")
      await api.buildCache()
      const { CustomPendleQuoteSource } = await import(
        "../swapService/strategies/aggregators/sources/pendleQuoteSource"
      )
      const quoteFetch = vi.fn().mockResolvedValue(
        response({
          routes: [
            {
              outputs: [{ amount: "42" }],
              tx: { to: market, data: "0x1234" },
              data: { aggregatorType: "kyberswap" },
            },
          ],
        }),
      )
      const params = {
        components: { fetchService: { fetch: quoteFetch } },
        request: {
          chainId: 146,
          sellToken: pt.address,
          buyToken: pt.underlying,
          order: { type: "sell", sellAmount: 10n ** BigInt(pt.decimals) },
          config: { slippagePercentage: 1, timeout: "30s" },
          accounts: { takeFrom: market, recipient: market },
        },
        config: {},
      } as unknown as Parameters<
        InstanceType<typeof CustomPendleQuoteSource>["quote"]
      >[0]
      const quote = await new CustomPendleQuoteSource("kyberswap").quote(params)

      expect(quote.buyAmount).toBe(42n)
      expect(quote.customData.tx).toEqual({ to: market, calldata: "0x1234" })
      expect(quoteFetch).toHaveBeenCalledTimes(1)
      const url = new URL(quoteFetch.mock.calls[0][0])
      expect(url.pathname).toBe("/core/v2/sdk/146/convert")
      expect(url.searchParams.get("tokensIn")).toBe(pt.address)
      expect(url.searchParams.get("tokensOut")).toBe(pt.underlying)
      expect(url.searchParams.get("amountsIn")).toBe(
        (10n ** BigInt(pt.decimals)).toString(),
      )
      expect((await api.getOrFetchToken(146, pt.address))?.metadata).toEqual({
        isPendlePT: true,
        isPendleLP: false,
      })
    },
  )
})
