import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
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

beforeEach(() => {
  vi.resetModules()
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
