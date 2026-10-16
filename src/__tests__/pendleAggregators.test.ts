import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fallback from "../swapService/strategies/aggregators/sources/pendle/pendleAggregators.json"

vi.mock("../common/utils/logs", () => ({
  logWarn: vi.fn(),
  logDev: vi.fn(),
  logProd: vi.fn(),
}))

const load = () =>
  import(
    "../swapService/strategies/aggregators/sources/pendle/pendleAggregatorConfig"
  )
const response = (data: unknown) => ({ ok: true, json: async () => data })
const providers = (...names: string[]) =>
  response({ aggregators: names.map((name) => ({ name })) })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Pendle aggregator discovery", () => {
  it("provides the reviewed fallback without making import-time requests", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    expect((await load()).getPendleAggregators()).toEqual(fallback)
    expect(fallback[1]).toContain("0x")
    expect(fallback[999]).toEqual(expect.arrayContaining(["okx", "0x"]))
    expect(fetch).not.toHaveBeenCalled()
  })

  it("registers discovered providers and replaces chain support and the pendle filter together", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/chains")) return response({ chainIds: [1, 999, 196] })
      if (url.includes("/sdk/1/")) return providers("0x", "new-provider", "0x")
      return providers("okx", "0x")
    })
    vi.stubGlobal("fetch", fetch)
    await (await load()).initPendleAggregators([1, 999, 1, 239])
    const tokenLists = await import("../common/utils/tokenList")
    vi.spyOn(tokenLists, "getAllTokenLists").mockReturnValue({ 1: [], 999: [] })
    const { StrategyAggregators, defaultConfig } = await import(
      "../swapService/strategies/strategyAggregators"
    )
    const strategy = new StrategyAggregators(
      {},
      {
        ...defaultConfig,
        sourcesFilter: { includeSources: ["pendle"] },
      },
    )
    expect(await strategy.providers(1)).toEqual([
      "pendle-0x",
      "pendle-new-provider",
    ])
    expect(await strategy.providers(999)).toEqual(["pendle-0x", "pendle-okx"])
    expect((await load()).getPendleAggregators()[1]).toEqual([
      "0x",
      "new-provider",
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("discovers configured chains absent from the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chains")
          ? response({ chainIds: [12345] })
          : providers("new-provider"),
      ),
    )
    const source = await load()
    await source.initPendleAggregators([12345])
    expect(source.getPendleAggregators()[12345]).toEqual(["new-provider"])
  })

  it.each([
    ["HTTP failure", () => ({ ok: false, status: 503 })],
    [
      "invalid JSON",
      () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Invalid JSON")
        },
      }),
    ],
    ["invalid payload", () => response({ aggregators: [{ name: "" }] })],
  ])(
    "retains only the failed chain's fallback on %s",
    async (_, failedResponse) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.endsWith("/chains")) return response({ chainIds: [1, 999] })
          return url.includes("/sdk/1/") ? failedResponse() : providers("0x")
        }),
      )
      const source = await load()
      await source.initPendleAggregators([1, 999])
      expect(source.getPendleAggregators()[1]).toEqual(fallback[1])
      expect(source.getPendleAggregators()[999]).toEqual(["0x"])
      const { logWarn } = await import("../common/utils/logs")
      expect(logWarn).toHaveBeenCalledWith(
        expect.objectContaining({ chainId: 1 }),
      )
    },
  )

  it("accepts an empty successful list to remove unsupported providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chains") ? response({ chainIds: [1] }) : providers(),
      ),
    )
    const source = await load()
    await source.initPendleAggregators([1])
    expect(source.getPendleAggregators()[1]).toEqual([])
  })

  it.each(["missing", "unavailable", "malformed"])(
    "refreshes known chains when the chain list is %s",
    async (state) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (!url.endsWith("/chains")) return providers("0x")
          if (state === "unavailable") throw new Error("Network unavailable")
          return response(
            state === "malformed" ? { chainIds: ["130"] } : { chainIds: [1] },
          )
        }),
      )
      const source = await load()
      await source.initPendleAggregators([130])
      expect(source.getPendleAggregators()[130]).toEqual(["0x"])
    },
  )

  it("bounds a stalled discovery request and retains the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, { signal }: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason)
            signal?.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            })
          }),
      ),
    )
    const source = await load()
    await source.initPendleAggregators([1, 999])
    expect(source.getPendleAggregators()[1]).toEqual(fallback[1])
    expect(source.getPendleAggregators()[999]).toEqual(fallback[999])
  }, 7_000)
})
