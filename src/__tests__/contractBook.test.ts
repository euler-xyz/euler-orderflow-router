import { beforeEach, expect, it, vi } from "vitest"

vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example" },
}))
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

it("does not reintroduce a retired network from the deployments feed", async () => {
  const swapper = "0x0000000000000000000000000000000000000001"
  const swapVerifier = "0x0000000000000000000000000000000000000002"
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          chainId: 1923,
          addresses: { peripheryAddrs: { swapper, swapVerifier } },
        },
        {
          chainId: 1,
          addresses: { peripheryAddrs: { swapper, swapVerifier } },
        },
      ],
    }),
  )
  const book = await import("../common/utils/contractBook")
  await book.refreshContractBookAddresses()
  expect(book.default.swapper.address[1923]).toBeUndefined()
  expect(book.default.swapVerifier.address[1923]).toBeUndefined()
  expect(book.default.swapper.address[1]).toBe(swapper)
  expect(book.default.swapVerifier.address[1]).toBe(swapVerifier)
})
