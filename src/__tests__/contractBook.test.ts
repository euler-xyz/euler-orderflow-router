import { beforeEach, expect, it, vi } from "vitest"

const chainIds = vi.hoisted(() => ({ served: 900001, unserved: 900002 }))
vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { [chainIds.served]: "https://rpc.example" },
}))
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

it("ignores deployments-feed networks the service does not serve", async () => {
  const swapper = "0x0000000000000000000000000000000000000001"
  const swapVerifier = "0x0000000000000000000000000000000000000002"
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          chainId: chainIds.unserved,
          addresses: { peripheryAddrs: { swapper, swapVerifier } },
        },
        {
          chainId: chainIds.served,
          addresses: { peripheryAddrs: { swapper, swapVerifier } },
        },
      ],
    }),
  )
  const book = await import("../common/utils/contractBook")
  await book.refreshContractBookAddresses()
  expect(book.default.swapper.address[chainIds.unserved]).toBeUndefined()
  expect(book.default.swapVerifier.address[chainIds.unserved]).toBeUndefined()
  expect(book.default.swapper.address[chainIds.served]).toBe(swapper)
  expect(book.default.swapVerifier.address[chainIds.served]).toBe(swapVerifier)
})
