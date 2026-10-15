import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listen: vi.fn(() => ({ close: vi.fn() })),
  error: vi.fn(),
  warn: vi.fn(),
  tokenInit: vi.fn(),
  loadDeployments: vi.fn(),
  initContractBookCache: vi.fn(),
}))
vi.mock("../server", () => ({
  app: { listen: mocks.listen },
  logger: { warn: mocks.warn, info: vi.fn(), error: mocks.error },
}))
vi.mock("../common/utils/tokenList", () => ({
  initTokenlistCache: mocks.tokenInit,
}))
vi.mock("../common/utils/deployments", () => ({
  loadDeployments: mocks.loadDeployments,
  initContractBookCache: mocks.initContractBookCache,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.loadDeployments.mockResolvedValue(undefined)
  mocks.tokenInit.mockResolvedValue(undefined)
  vi.spyOn(process, "on").mockReturnValue(process)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("server startup", () => {
  it("loads deployments before initializing tokens or listening", async () => {
    let resolve!: () => void
    mocks.loadDeployments.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    await import("../index")
    expect(mocks.loadDeployments).toHaveBeenCalledOnce()
    expect(mocks.tokenInit).not.toHaveBeenCalled()
    expect(mocks.listen).not.toHaveBeenCalled()
    resolve()
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
    expect(mocks.tokenInit).toHaveBeenCalledOnce()
  })

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
    resolve(undefined as unknown as ReturnType<typeof setInterval>)
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
  })

  it("warns and starts with fallback addresses when deployments fail to load", async () => {
    const error = new Error("Deployments unavailable")
    mocks.loadDeployments.mockRejectedValue(error)
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)
    await import("../index")
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce())
    expect(mocks.tokenInit).toHaveBeenCalledOnce()
    expect(mocks.initContractBookCache).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      { err: error },
      "Failed to refresh contractBook addresses on startup",
    )
  })

  it("exits without listening when initial token loading fails", async () => {
    const error = new Error("Initial tokenlist load failed")
    mocks.tokenInit.mockRejectedValue(error)
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)
    await import("../index")
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(mocks.listen).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(
      { err: error },
      "Server startup failed",
    )
  })
})
