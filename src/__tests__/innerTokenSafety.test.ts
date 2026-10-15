import { zeroAddress } from "viem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SwapperMode } from "../swapService/interface"
import type { SwapParams } from "../swapService/types"

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  pipeline: vi.fn(),
  price: vi.fn(),
}))
const paymentAddress = "0x0000000000000000000000000000000000000001"
const mAddress = "0x0000000000000000000000000000000000000002"
const stale = {
  chainId: 1,
  address: paymentAddress,
  name: "Payment",
  symbol: "PAY",
  decimals: 18,
  logoURI: "",
}
vi.mock("../common/utils/tokenList", () => ({
  getOrFetchToken: mocks.resolve,
  findTokenInCache: () => ({
    chainId: 1,
    address: "0x0000000000000000000000000000000000000001",
    name: "Payment",
    symbol: "PAY",
    decimals: 18,
    logoURI: "",
  }),
}))
vi.mock("../common/utils/viemClients", () => ({
  RPC_URLS: { 1: "https://rpc.example" },
  viemClients: { 1: { extend: () => ({ readContract: mocks.price }) } },
}))
vi.mock("../common/utils/logs", () => ({
  logWarn: vi.fn(),
  logDev: vi.fn(),
  logProd: vi.fn(),
}))
vi.mock("../swapService/runner", () => ({ runPipeline: mocks.pipeline }))
vi.mock("../swapService/utils", async (original) => ({
  ...(await original<typeof import("../swapService/utils")>()),
  encodeSwapMulticallItem: () => ({
    to: "0x0000000000000000000000000000000000000001",
    data: "0x",
  }),
}))

const params = {
  chainId: 1,
  tokenIn: { ...stale, address: mAddress },
  tokenOut: stale,
  swapperMode: SwapperMode.EXACT_IN,
  amount: 1n,
  targetDebt: 0n,
  from: zeroAddress,
  accountIn: zeroAddress,
  accountOut: zeroAddress,
  receiver: zeroAddress,
  vaultIn: zeroAddress,
  vaultOut: zeroAddress,
} as unknown as SwapParams

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue({ ...stale, decimals: 6 })
  mocks.price.mockResolvedValue(100_000_000n)
  mocks.pipeline.mockRejectedValue(new Error("Captured inner quote"))
})

const midas = async () => {
  const { StrategyMidas } = await import(
    "../swapService/strategies/strategyMidas"
  )
  return new StrategyMidas(
    {},
    {
      mTokens: {
        1: {
          TEST: {
            tokenContract: mAddress,
            paymentToken: paymentAddress,
            depositorContract: mAddress,
            redeemerContract: mAddress,
            oracleContract: mAddress,
            paymentTokenSweepVault: mAddress,
            priceOne: 100_000_000n,
            redemptionInstantFeeBps: 0n,
          },
        },
      },
    },
  )
}

describe("verified inner-token consumers", () => {
  it("resolves the inner token through the verifier instead of stale cache metadata", async () => {
    const { findToken } = await import("../swapService/utils")
    expect((await findToken(1, paymentAddress))?.decimals).toBe(6)
    expect(mocks.resolve).toHaveBeenCalled()
  })
  it("rejects an unresolved inner token", async () => {
    mocks.resolve.mockResolvedValue(undefined)
    const { findToken } = await import("../swapService/utils")
    await expect(
      Promise.resolve().then(() => findToken(1, paymentAddress)),
    ).rejects.toThrow("verified token metadata")
  })
  it("passes a resolved connector token into the inner quote", async () => {
    const { StrategyConnect2 } = await import(
      "../swapService/strategies/strategyConnect2"
    )
    const strategy = new StrategyConnect2(
      {},
      {
        chainId: 1,
        connector: paymentAddress,
        connectorDustVault: zeroAddress,
      },
    )
    await expect(strategy.exactIn(params)).rejects.toThrow(
      "Captured inner quote",
    )
    expect(mocks.pipeline.mock.calls[0][0].tokenOut.decimals).toBe(6)
  })
  it("uses six-decimal payment units in the real Midas deposit calculation", async () => {
    const result = await (await midas()).encodeMTBILLDepositInstant(
      params,
      1_234_567n,
      false,
      paymentAddress,
    )
    expect(result.amountIn).toBe(1_234_567n)
    expect(result.amountOut).toBe(1_234_567_000_000_000_000n)
  })
  it("uses six-decimal payment units in the real Midas redemption calculation", async () => {
    const result = await (await midas()).encodeMTBILLRedeemInstant(
      params,
      1_000_000_000_000_000_000n,
      true,
      paymentAddress,
    )
    expect(result.amountOut).toBe(1_000_000n)
  })
  it("rejects Midas calldata generation when payment decimals are unresolved", async () => {
    mocks.resolve.mockResolvedValue(undefined)
    await expect(
      (await midas()).encodeMTBILLDepositInstant(
        params,
        1n,
        false,
        paymentAddress,
      ),
    ).rejects.toThrow("verified token metadata")
    expect(mocks.price).not.toHaveBeenCalled()
  })
})
