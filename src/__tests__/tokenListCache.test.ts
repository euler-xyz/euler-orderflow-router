import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import routingToken from "./fixtures/v3RoutingToken.json"

const mocks = vi.hoisted(() => ({
  rpcUrls: {} as Record<number, string>,
  warn: vi.fn(),
}))
vi.mock("../common/utils/viemClients", () => ({ RPC_URLS: mocks.rpcUrls }))
vi.mock("../common/utils/logs", () => ({ logWarn: mocks.warn }))

const token = {
  chainId: 1,
  address: "0x0000000000000000000000000000000000000001",
  decimals: 6,
  name: "Token",
  symbol: "TOK",
  logoURI:
    "https://v3.euler.finance/v3/images/tokens/1/0x0000000000000000000000000000000000000001?v=1234",
}
const response = (data = [token], meta?: object) => ({
  ok: true,
  json: async () => ({ data, meta }),
})
const failure = () => ({ ok: false, status: 503, statusText: "Unavailable" })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  for (const chain of Object.keys(mocks.rpcUrls))
    delete mocks.rpcUrls[Number(chain)]
  mocks.rpcUrls[1] = "https://rpc.example"
  vi.stubEnv("TOKENLIST_URL", "https://v3.euler.finance/v3/tokens")
  vi.stubEnv("TOKENLIST_URL_1", "")
  vi.stubEnv("TOKENLIST_CACHE_TIMEOUT_SECONDS", "300")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const load = () => import("../common/utils/tokenList")

describe("V3 token cache", () => {
  it("requires the upstream endpoint", async () => {
    vi.stubEnv("TOKENLIST_URL", "")
    await expect((await load()).buildCache()).rejects.toThrow(
      "TOKENLIST_URL is required",
    )
  })

  it("requires a configured RPC chain", async () => {
    mocks.rpcUrls[1] = ""
    await expect((await load()).buildCache()).rejects.toThrow(
      "At least one RPC_URL",
    )
  })

  it("fetches only configured chains and preserves V3 routing metadata", async () => {
    mocks.rpcUrls[8453] = ""
    const fetchMock = vi.fn().mockResolvedValue(response([routingToken]))
    vi.stubGlobal("fetch", fetchMock)
    const api = await load()
    const cache = await api.buildCache()
    expect(fetchMock).toHaveBeenCalledOnce()
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get("chainId")).toBe("1")
    expect(cache[8453]).toBeUndefined()
    expect(
      api.findTokenInCache(1, routingToken.address as `0x${string}`)?.metadata,
    ).toEqual(routingToken.metadata)
    expect(cache[1][0].logoURI).toBe(routingToken.logoURI.split("?")[0])
  })

  it("preserves per-chain endpoint overrides and reads all pages", async () => {
    vi.stubEnv("TOKENLIST_URL_1", "https://v3.example/v3/tokens")
    const second = {
      ...token,
      address: "0x0000000000000000000000000000000000000002",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response([token], { total: 2, limit: 1, offset: 0 }),
      )
      .mockResolvedValueOnce(
        response([second], { total: 2, limit: 1, offset: 1 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const cache = await (await load()).buildCache()
    expect(cache[1]).toHaveLength(2)
    expect(new URL(fetchMock.mock.calls[0][0]).origin).toBe(
      "https://v3.example",
    )
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("offset")).toBe(
      "1",
    )
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      fetchMock.mock.calls[1][1].signal,
    )
  })

  it("rejects pagination that cannot advance", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response([token], { total: 2, limit: 0, offset: 0 }),
        ),
    )
    await expect((await load()).buildCache()).rejects.toThrow(
      "Initial tokenlist load failed",
    )
    expect(mocks.warn.mock.calls[0][0].error.message).toBe(
      "Invalid tokenlist pagination",
    )
  })

  it("rejects an incomplete later page without replacing the successful cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        response([token], { total: 2, limit: 1, offset: 0 }),
      )
      .mockResolvedValueOnce(response([], { total: 2, limit: 1, offset: 1 }))
    vi.stubGlobal("fetch", fetchMock)
    const api = await load()
    await api.buildCache()
    const previous = api.default(1)
    await api.buildCache()
    expect(api.default(1)).toBe(previous)
    expect(mocks.warn.mock.calls[0][0].error.message).toBe(
      "Incomplete tokenlist response",
    )
  })

  it("refreshes healthy chains while keeping the failed chain in memory", async () => {
    mocks.rpcUrls[143] = "https://rpc.example"
    const monad = { ...token, chainId: 143 }
    let failedRefresh = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const chain = new URL(url).searchParams.get("chainId")
        if (chain === "143") return response([monad])
        return failedRefresh ? failure() : response()
      }),
    )
    const api = await load()
    await api.buildCache()
    const mainnet = api.default(1)
    const oldMonad = api.default(143)
    failedRefresh = true
    await api.buildCache()
    expect(api.default(1)).toBe(mainnet)
    expect(api.default(143)).not.toBe(oldMonad)
    expect(api.default(143)).toHaveLength(5)
  })

  it("shares an in-flight refresh", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const api = await load()
    const first = api.buildCache()
    const second = api.buildCache()
    expect(first).toBe(second)
    resolve(response())
    await first
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(["HTTP", "empty", "invalid"])(
    "rejects a %s initial fetch without seeding a static list",
    async (mode) => {
      const value =
        mode === "HTTP"
          ? failure()
          : mode === "empty"
            ? response([])
            : { ok: true, json: async () => ({ error: "bad" }) }
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(value))
      const api = await load()
      await expect(api.buildCache()).rejects.toThrow(
        "Initial tokenlist load failed for chain 1",
      )
      expect(api.getAllTokenLists()).toEqual({})
    },
  )

  it.each(["HTTP", "empty"])(
    "retains a successful list after a %s refresh failure",
    async (mode) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(mode === "HTTP" ? failure() : response([]))
      vi.stubGlobal("fetch", fetchMock)
      const api = await load()
      await api.buildCache()
      const previous = api.default(1)
      await api.buildCache()
      expect(api.default(1)).toBe(previous)
      expect(previous).toHaveLength(1)
    },
  )

  it("adds all four Monad custom tokens without overriding V3", async () => {
    delete mocks.rpcUrls[1]
    mocks.rpcUrls[143] = "https://rpc.example"
    const upstream = {
      ...token,
      chainId: 143,
      address: "0x2DAA146dfB7EAef0038F9F15B2EC1e4DE003f72b",
      name: "V3 name",
      symbol: "V3 symbol",
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([upstream])))
    const api = await load()
    const cache = await api.buildCache()
    expect(cache[143]).toHaveLength(4)
    expect(cache[143][0].name).toBe("V3 name")
    expect(cache[143].slice(1).map((t) => t.decimals)).toEqual([6, 6, 6])
    await api.buildCache()
    expect(cache[143]).toHaveLength(4)
  })

  it("does not activate Monad through the custom overlay", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
    expect((await (await load()).buildCache())[143]).toBeUndefined()
  })

  it("waits for initial loading before scheduling refreshes", async () => {
    vi.useFakeTimers()
    let resolve!: (value: ReturnType<typeof response>) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        }),
      )
      .mockResolvedValue(response())
    vi.stubGlobal("fetch", fetchMock)
    const api = await load()
    const startup = api.initTokenlistCache()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    resolve(response())
    const timer = await startup
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    clearInterval(timer)
  })

  it("does not schedule a refresh when startup fails", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(failure())
    vi.stubGlobal("fetch", fetchMock)
    await expect((await load()).initTokenlistCache()).rejects.toThrow(
      "Initial tokenlist load failed",
    )
    await vi.advanceTimersByTimeAsync(300_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
