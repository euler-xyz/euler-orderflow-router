import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))
const token = {
  chainId: 146,
  address: "0x0000000000000000000000000000000000000001",
  name: "Listed",
  symbol: "TOK",
  decimals: 18,
  logoURI: "",
}
const response = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const load = () => import("../common/utils/tokenSources")

describe("automatic token discovery", () => {
  it("prefers DefiLlama, deduplicates addresses, filters chains and strips protocol claims", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("tokenlists-")
          ? response({ a: { ...token, metadata: { isPendlePT: true } } })
          : response({
              tokens: [
                { ...token, name: "Uniswap" },
                { ...token, chainId: 1 },
              ],
            }),
      ),
    )
    expect(await (await load()).fetchFallbackTokens(146)).toEqual([token])
  })
  it("uses a working Uniswap publication when DefiLlama is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("tokenlists-")
          ? { ok: false, status: 403 }
          : response({ tokens: [token] }),
      ),
    )
    expect(await (await load()).fetchFallbackTokens(146)).toHaveLength(1)
  })
  it("returns no catalog when both sources fail so RPC discovery can handle requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    )
    expect(await (await load()).fetchFallbackTokens(146)).toEqual([])
  })
  it("shares the global Uniswap fetch across chains", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("tokenlists-")
        ? response({})
        : response({ tokens: [token] }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const source = await load()
    await Promise.all([
      source.fetchFallbackTokens(146),
      source.fetchFallbackTokens(80094),
    ])
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("unpkg.com")),
    ).toHaveLength(1)
  })
  it("filters native placeholders and invalid addresses or decimals", async () => {
    const source = await load()
    expect(
      source.normalizeListedToken(
        { ...token, address: "0x0000000000000000000000000000000000000000" },
        146,
      ),
    ).toBeUndefined()
    expect(
      source.normalizeListedToken({ ...token, address: "invalid" }, 146),
    ).toBeUndefined()
    expect(
      source.normalizeListedToken({ ...token, decimals: 256 }, 146),
    ).toBeUndefined()
    expect(
      source.normalizeListedToken({ ...token, decimals: 0 }, 146)?.decimals,
    ).toBe(0)
  })
})

describe("authoritative Pendle market discovery", () => {
  const stubMarkets = (
    fetchMock: (url: string, init?: RequestInit) => Promise<unknown>,
  ) =>
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      new URL(url).pathname.endsWith("/assets/all")
        ? Promise.resolve(response({ assets: [] }))
        : fetchMock(url, init),
    )
  const market = {
    chainId: 146,
    address: "0x0000000000000000000000000000000000000002",
    pt: "146-0x0000000000000000000000000000000000000001",
  }
  it("reads all pages and identifies PT and LP addresses without using symbols", async () => {
    const second = {
      ...market,
      address: "0x0000000000000000000000000000000000000004",
      pt: "146-0x0000000000000000000000000000000000000003",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ results: [market], total: 2, skip: 0 }))
      .mockResolvedValueOnce(response({ results: [second], total: 2, skip: 1 }))
    stubMarkets(fetchMock)
    const metadata = await (await load()).fetchPendleMetadata(146)
    expect(metadata.get(token.address)).toMatchObject({
      isPendlePT: true,
      pendleMarket: market.address,
    })
    expect(metadata.get(market.address)).toMatchObject({ isPendleLP: true })
    expect(metadata.size).toBe(4)
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("skip")).toBe(
      "1",
    )
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      fetchMock.mock.calls[1][1].signal,
    )
  })
  it("does not invent a market when a PT appears in different markets", async () => {
    stubMarkets(
      vi.fn().mockResolvedValue(
        response({
          results: [
            market,
            {
              ...market,
              address: "0x0000000000000000000000000000000000000003",
            },
          ],
          total: 2,
        }),
      ),
    )
    expect(
      (await (await load()).fetchPendleMetadata(146)).get(token.address)
        ?.pendleMarket,
    ).toBeUndefined()
  })
  it("rejects incomplete pages without publishing partial metadata", async () => {
    stubMarkets(
      vi
        .fn()
        .mockResolvedValueOnce(response({ results: [market], total: 2 }))
        .mockResolvedValueOnce(response({ results: [], total: 2, skip: 1 })),
    )
    expect((await (await load()).fetchPendleMetadata(146)).size).toBe(0)
  })
  it("filters records from other chains and chain-prefixed PT identities", async () => {
    stubMarkets(
      vi.fn().mockResolvedValue(
        response({
          results: [
            { ...market, chainId: 1 },
            { ...market, pt: `1-${token.address}` },
          ],
          total: 2,
        }),
      ),
    )
    const metadata = await (await load()).fetchPendleMetadata(146)
    expect(metadata.has(token.address)).toBe(false)
    expect(metadata.get(market.address)?.isPendleLP).toBe(true)
  })
  it("retains the previous market map on a later provider failure", async () => {
    vi.useFakeTimers()
    stubMarkets(
      vi
        .fn()
        .mockResolvedValueOnce(response({ results: [market], total: 1 }))
        .mockResolvedValueOnce({ ok: false, status: 503 }),
    )
    const source = await load()
    const first = await source.fetchPendleMetadata(146)
    await vi.advanceTimersByTimeAsync(300_001)
    expect(await source.fetchPendleMetadata(146)).toBe(first)
  })
})

describe("authoritative Pendle asset discovery", () => {
  const asset = { chainId: 146, address: token.address, tags: ["PT"] }
  const market = {
    chainId: 146,
    address: "0x0000000000000000000000000000000000000002",
    pt: `146-${token.address}`,
  }
  const unlisted = "0x0000000000000000000000000000000000000003"

  it("supplements market metadata only with valid PT assets on the requested chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith("/assets/all")
          ? response({
              assets: [
                asset,
                { ...asset, address: unlisted },
                {
                  ...asset,
                  chainId: 1,
                  address: "0x0000000000000000000000000000000000000004",
                },
                {
                  ...asset,
                  tags: ["YT"],
                  symbol: "PT-lookalike",
                  address: "0x0000000000000000000000000000000000000005",
                },
                {
                  ...asset,
                  tags: "PT",
                  address: "0x0000000000000000000000000000000000000006",
                },
                { ...asset, address: "invalid" },
                {
                  ...asset,
                  address: "0x0000000000000000000000000000000000000000",
                },
                { ...asset, address: 42 },
                null,
              ],
            })
          : response({ results: [market], total: 1 }),
      ),
    )
    const metadata = await (await load()).fetchPendleMetadata(146)
    expect(metadata.size).toBe(3)
    expect(metadata.get(token.address)?.pendleMarket).toBe(market.address)
    expect(metadata.get(market.address)?.isPendleLP).toBe(true)
    expect(metadata.get(unlisted)).toEqual({
      isPendlePT: true,
      isPendleLP: false,
    })
  })

  it.each([{ ok: false, status: 503 }, response({ assets: null })])(
    "keeps market discovery available when the asset source fails: %j",
    async (failure) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) =>
          new URL(input).pathname.endsWith("/assets/all")
            ? failure
            : response({ results: [market], total: 1 }),
        ),
      )
      const metadata = await (await load()).fetchPendleMetadata(146)
      expect(metadata.size).toBe(2)
      expect(metadata.get(token.address)?.pendleMarket).toBe(market.address)
    },
  )

  it("retains cached PT classification during an asset-source outage", async () => {
    vi.useFakeTimers()
    const assets = vi
      .fn()
      .mockResolvedValueOnce(response({ assets: [asset] }))
      .mockResolvedValueOnce({ ok: false, status: 503 })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith("/assets/all")
          ? assets()
          : response({ results: [], total: 0 }),
      ),
    )
    const source = await load()
    const first = await source.fetchPendleMetadata(146)
    expect(first.get(token.address)?.isPendlePT).toBe(true)
    await vi.advanceTimersByTimeAsync(300_001)
    expect(await source.fetchPendleMetadata(146)).toEqual(first)
    expect(assets).toHaveBeenCalledTimes(2)
  })
})
