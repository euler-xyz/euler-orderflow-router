import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example" },
}))
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))
vi.mock("../common/utils/tokenSources", async (original) => ({
  ...(await original<typeof import("../common/utils/tokenSources")>()),
  fetchPendleMetadata: async () => new Map(),
}))
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ extend: () => ({ readContract: mocks.read }) }),
}))
const token = {
  chainId: 1,
  address: "0x0000000000000000000000000000000000000001" as const,
  decimals: 18,
  name: "Token",
  symbol: "TOK",
  logoURI: "",
  metadata: {
    isPendlePT: true,
    pendleMarket: "0x0000000000000000000000000000000000000002",
  },
}

beforeEach(() => {
  vi.resetModules()
  mocks.read.mockReset()
  vi.stubEnv("TOKENLIST_URL", "https://v3.example/v3/tokens")
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [token] }) }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const load = async () => {
  const api = await import("../common/utils/tokenList")
  await api.buildCache()
  return api
}

describe("contract-verified token decimals", () => {
  it.each([0, 6, 8, 17, 18])(
    "uses contract decimals %i and preserves routing metadata",
    async (decimals) => {
      mocks.read.mockResolvedValue(decimals)
      const resolved = await (await load()).getOrFetchToken(1, token.address)
      expect(resolved?.decimals).toBe(decimals)
      expect(resolved?.metadata).toEqual(token.metadata)
    },
  )
  it("rejects quoting metadata when the RPC read fails", async () => {
    mocks.read.mockRejectedValue(new Error("RPC down"))
    expect(
      await (await load()).getOrFetchToken(1, token.address),
    ).toBeUndefined()
  })
  it.each([-1, 256, 1.5, undefined, null])(
    "rejects invalid contract decimals %s",
    async (decimals) => {
      mocks.read.mockResolvedValue(decimals)
      expect(
        await (await load()).getOrFetchToken(1, token.address),
      ).toBeUndefined()
    },
  )
  it("shares concurrent verification and retains it across list refreshes", async () => {
    mocks.read.mockResolvedValue(6)
    const api = await load()
    await Promise.all([
      api.getOrFetchToken(1, token.address),
      api.getOrFetchToken(1, token.address),
    ])
    expect(mocks.read).toHaveBeenCalledOnce()
    await api.buildCache()
    expect((await api.getOrFetchToken(1, token.address))?.decimals).toBe(6)
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it("retries a failed verification on the next request", async () => {
    mocks.read
      .mockRejectedValueOnce(new Error("RPC down"))
      .mockResolvedValueOnce(8)
    const api = await load()
    expect(await api.getOrFetchToken(1, token.address)).toBeUndefined()
    expect((await api.getOrFetchToken(1, token.address))?.decimals).toBe(8)
  })
  it("discovers an unlisted ERC-20 using its contract", async () => {
    const unknown = "0x0000000000000000000000000000000000000003"
    mocks.read.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        ({ name: "Discovered", symbol: "NEW", decimals: 6 })[
          functionName as "name" | "symbol" | "decimals"
        ],
    )
    const resolved = await (await load()).getOrFetchToken(1, unknown)
    expect(resolved).toMatchObject({
      address: unknown,
      symbol: "NEW",
      decimals: 6,
    })
  })
  it("does not resolve an unconfigured or retired network", async () => {
    expect(
      await (await load()).getOrFetchToken(1923, token.address),
    ).toBeUndefined()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
