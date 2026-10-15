import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example", 8453: "", 42161: "", 31337: "" },
}))
const mocks = vi.hoisted(() => ({ logWarn: vi.fn() }))
vi.mock("../common/utils/logs", () => ({ logWarn: mocks.logWarn }))

const swapper = "0x0000000000000000000000000000000000000001"
const swapVerifier = "0x0000000000000000000000000000000000000002"
const fallbackSwapper = "0x719F8b330CcA71cb6195D032A43194C7D3F9Fb45"
const fallbackSwapVerifier = "0x786c900d7D348662703C38B46f24c1cda2C582AB"

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv("DEPLOYMENTS_URL", "")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("SDK deployments", () => {
  it("resolves fallback addresses before loading deployments", async () => {
    const deployments = await import("../common/utils/deployments")
    expect(deployments.getSwapperAddress(1)).toBe(fallbackSwapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(fallbackSwapVerifier)
    expect(() => deployments.getSwapperAddress(137)).toThrow(
      "swapper contract not found for chainId 137",
    )
  })

  it("refreshes supported networks without reintroducing a retired network from the feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          {
            chainId: 1923,
            addresses: { peripheryAddrs: { swapper, swapVerifier } },
          },
          {
            chainId: 1,
            addresses: { peripheryAddrs: { swapper, swapVerifier } },
          },
        ]),
      ),
    )
    const deployments = await import("../common/utils/deployments")
    await deployments.loadDeployments()
    expect(deployments.getSwapperAddress(1)).toBe(swapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(swapVerifier)
    expect(() => deployments.getSwapperAddress(1923)).toThrow(
      "swapper contract not found for chainId 1923",
    )
    expect(() => deployments.getSwapVerifierAddress(1923)).toThrow(
      "swapVerifier contract not found for chainId 1923",
    )
  })

  it("retains fallbacks for chains and addresses missing from the feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json([
          { chainId: 1, addresses: { peripheryAddrs: { swapper } } },
          { chainId: 8453, addresses: {} },
        ]),
      ),
    )
    const deployments = await import("../common/utils/deployments")
    await deployments.loadDeployments()
    expect(deployments.getSwapperAddress(1)).toBe(swapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(fallbackSwapVerifier)
    expect(deployments.getSwapperAddress(8453)).toBe(
      "0xd54d9Fc684169287f34DA6d57Aa002B424eEbC05",
    )
    expect(deployments.getSwapperAddress(42161)).toBe(
      "0x4AaA129FaD81a65Dab41b1fa7e964CBB9B30C848",
    )
    expect(() => deployments.getSwapperAddress(31337)).toThrow(
      "swapper contract not found for chainId 31337",
    )
  })

  it("uses the configured deployments URL", async () => {
    vi.stubEnv("DEPLOYMENTS_URL", "https://deployments.example/chains.json")
    const fetch = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal("fetch", fetch)
    const { loadDeployments } = await import("../common/utils/deployments")
    await loadDeployments()
    expect(fetch).toHaveBeenCalledWith(
      "https://deployments.example/chains.json",
    )
  })

  it.each([
    ["network error", () => Promise.reject(new Error("Feed unavailable"))],
    [
      "HTTP error",
      () => Promise.resolve(new Response("Unavailable", { status: 503 })),
    ],
    ["invalid JSON", () => Promise.resolve(new Response("invalid JSON"))],
    [
      "invalid feed",
      () => Promise.resolve(Response.json({ error: "Invalid feed" })),
    ],
  ])("retains fallback addresses after a %s", async (_name, fetch) => {
    vi.stubGlobal("fetch", vi.fn(fetch))
    const deployments = await import("../common/utils/deployments")
    await expect(deployments.loadDeployments()).rejects.toThrow()
    expect(deployments.getSwapperAddress(1)).toBe(fallbackSwapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(fallbackSwapVerifier)
  })

  it("retains refreshed addresses on failure and can retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([
          {
            chainId: 1,
            addresses: { peripheryAddrs: { swapper, swapVerifier } },
          },
        ]),
      )
      .mockRejectedValueOnce(new Error("Feed unavailable"))
      .mockResolvedValueOnce(
        Response.json([
          {
            chainId: 1,
            addresses: { peripheryAddrs: { swapper: fallbackSwapper } },
          },
        ]),
      )
    vi.stubGlobal("fetch", fetch)
    const deployments = await import("../common/utils/deployments")
    await deployments.loadDeployments()
    await expect(deployments.loadDeployments()).rejects.toThrow(
      "Feed unavailable",
    )
    expect(deployments.getSwapperAddress(1)).toBe(swapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(swapVerifier)
    await deployments.loadDeployments()
    expect(deployments.getSwapperAddress(1)).toBe(fallbackSwapper)
    expect(deployments.getSwapVerifierAddress(1)).toBe(swapVerifier)
  })

  it("shares a fetch between overlapping refreshes", async () => {
    let resolve!: (response: Response) => void
    const fetch = vi.fn().mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    vi.stubGlobal("fetch", fetch)
    const { loadDeployments } = await import("../common/utils/deployments")
    const first = loadDeployments()
    const second = loadDeployments()
    expect(fetch).toHaveBeenCalledOnce()
    resolve(Response.json([]))
    await Promise.all([first, second])
  })

  it("retries periodic refreshes after a failed fetch", async () => {
    vi.stubEnv("CONTRACT_BOOK_CACHE_TIMEOUT_SECONDS", "1")
    const error = new Error("Feed unavailable")
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(
        Response.json([
          {
            chainId: 1,
            addresses: { peripheryAddrs: { swapper, swapVerifier } },
          },
        ]),
      )
    vi.stubGlobal("fetch", fetch)
    const deployments = await import("../common/utils/deployments")
    vi.useFakeTimers()
    const timer = deployments.initContractBookCache()
    try {
      await vi.advanceTimersByTimeAsync(1000)
      expect(deployments.getSwapperAddress(1)).toBe(fallbackSwapper)
      expect(mocks.logWarn).toHaveBeenCalledWith({
        name: "Error refreshing contractBook addresses",
        error,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(deployments.getSwapperAddress(1)).toBe(swapper)
      expect(deployments.getSwapVerifierAddress(1)).toBe(swapVerifier)
    } finally {
      clearInterval(timer)
    }
  })
})
