import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  pendleInit: vi.fn(),
  listen: vi.fn(() => ({ close: vi.fn() })),
  error: vi.fn(),
  tokenInit: vi.fn(),
  bookInit: vi.fn(),
  bookRefresh: vi.fn(),
}))
vi.mock("../server", () => ({
  app: { listen: mocks.listen },
  logger: { warn: vi.fn(), info: vi.fn(), error: mocks.error },
}))
vi.mock("../common/utils/tokenList", () => ({
  initTokenlistCache: mocks.tokenInit,
}))
vi.mock("../common/utils/contractBook", () => ({
  initContractBookCache: mocks.bookInit,
  refreshContractBookAddresses: mocks.bookRefresh,
}))
vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example", 999: "https://rpc.example", 146: "" },
}))
vi.mock(
  "../swapService/strategies/aggregators/sources/pendle/pendleAggregatorConfig",
  () => ({ initPendleAggregators: mocks.pendleInit }),
)

beforeEach(() => {
  vi.resetModules()
  mocks.pendleInit.mockResolvedValue(undefined)
  vi.clearAllMocks()
  mocks.bookRefresh.mockResolvedValue(undefined)
  vi.spyOn(process, "on").mockReturnValue(process)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("server startup", () => {
  it("does not listen until the initial token cache is ready", async () => {
    let resolve!: (value: ReturnType<typeof setInterval>) => void
    mocks.tokenInit.mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    await import("../index")
    await vi.waitFor(() => expect(mocks.tokenInit).toHaveBeenCalledOnce())
    expect(mocks.listen).not.toHaveBeenCalled()
    expect(mocks.bookInit).not.toHaveBeenCalled()
    resolve(undefined as unknown as ReturnType<typeof setInterval>)
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
    expect(mocks.bookInit).toHaveBeenCalledOnce()
  })

  it("exits without listening when initial token loading fails", async () => {
    mocks.tokenInit.mockRejectedValue(
      new Error("Initial tokenlist load failed"),
    )
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)
    await import("../index")
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(mocks.listen).not.toHaveBeenCalled()
    expect(mocks.bookInit).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
  })
})

describe("Pendle discovery startup", () => {
  it("waits for Pendle discovery before listening and only queries configured chains", async () => {
    let resolve!: () => void
    mocks.pendleInit.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    mocks.tokenInit.mockResolvedValue(undefined)
    await import("../index")
    await vi.waitFor(() =>
      expect(mocks.pendleInit).toHaveBeenCalledWith([1, 999]),
    )
    expect(mocks.listen).not.toHaveBeenCalled()
    resolve()
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
  })
})
