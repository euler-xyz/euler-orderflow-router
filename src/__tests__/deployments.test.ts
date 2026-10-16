import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example", 8453: "", 42161: "" },
}))

const swapper = "0x0000000000000000000000000000000000000001"
const swapVerifier = "0x0000000000000000000000000000000000000002"

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("DEPLOYMENTS_URL", "")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("SDK deployments", () => {
  it("requires deployments to be loaded before resolving addresses", async () => {
    const deployments = await import("../common/utils/deployments")
    expect(() => deployments.getSwapperAddress(1)).toThrow(
      "Deployments not loaded",
    )
    expect(() => deployments.getSwapVerifierAddress(1)).toThrow(
      "Deployments not loaded",
    )
  })

  it("resolves supported networks without reintroducing a retired network from the feed", async () => {
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

  it("rejects chains and contract addresses missing from the feed", async () => {
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
    expect(() => deployments.getSwapVerifierAddress(1)).toThrow(
      "swapVerifier contract not found for chainId 1",
    )
    expect(() => deployments.getSwapperAddress(8453)).toThrow(
      "swapper contract not found for chainId 8453",
    )
    expect(() => deployments.getSwapperAddress(42161)).toThrow(
      "swapper contract not found for chainId 42161",
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

  it("propagates an unavailable feed instead of supplying fallback addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Feed unavailable")),
    )
    const deployments = await import("../common/utils/deployments")
    await expect(deployments.loadDeployments()).rejects.toThrow(
      "Feed unavailable",
    )
    expect(() => deployments.getSwapperAddress(1)).toThrow(
      "Deployments not loaded",
    )
  })

  it("rejects an invalid deployments feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "Invalid feed" })),
    )
    const { loadDeployments } = await import("../common/utils/deployments")
    await expect(loadDeployments()).rejects.toThrow(
      "Invalid deployment data format",
    )
  })
})
