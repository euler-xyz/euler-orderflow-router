import { Addresses } from "@balmy/sdk"
import { encodeFunctionData, parseAbi } from "viem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CustomCleaveQuoteSource } from "../swapService/strategies/aggregators/sources/cleaveQuoteSource"

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
const SWAPPER = "0x719F8b330CcA71cb6195D032A43194C7D3F9Fb45"
const VAULT = "0x000000000000000000000000000000000000bEEF"
const SHELL = "0x016750b998AaB0b4b07AA6a2276335053A798758"
const NOW_MS = 1_800_000_000_000
const DEADLINE = 1_800_003_600n
const AMOUNT_IN = 1_000_000_000n
const MIN_OUT = 397960200000000000n

const abi = parseAbi([
  "function swapWithBlob((address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline, address recipient, address referrer, uint16 referralFeeBps, bool wethAsErc20) params, bytes blob)",
])

const swapData = (over: Record<string, unknown> = {}) =>
  encodeFunctionData({
    abi,
    functionName: "swapWithBlob",
    args: [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        amountIn: AMOUNT_IN,
        minAmountOut: MIN_OUT,
        deadline: DEADLINE,
        recipient: VAULT,
        referrer: "0x0000000000000000000000000000000000000000",
        referralFeeBps: 0,
        wethAsErc20: true,
        ...over,
      },
      "0x0501",
    ],
  })

const quoteBody = (
  call: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) => ({
  status: "ok",
  amountOutGross: "400000000000000000",
  amountOutNet: "399960000000000000",
  minOut: MIN_OUT.toString(),
  partial: { refusedAtSource: "0", swappedAmountIn: AMOUNT_IN.toString() },
  remainders: [],
  preferredExecution: "classic",
  execution: {
    target: SHELL,
    approval: { token: USDC, spender: SHELL, amount: AMOUNT_IN.toString() },
  },
  tx: { to: SHELL, data: swapData(call), value: "0" },
  ...over,
})

const reply = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

function quoteWith(
  body: unknown,
  status = 200,
  overrides: { sellToken?: string; recipient?: string } = {},
) {
  const fetch = vi.fn(async (_url: string, _init?: any) => reply(body, status))
  const source = new CustomCleaveQuoteSource()
  const result = source.quote({
    components: { fetchService: { fetch } },
    config: { apiKey: "cq_live_test" },
    request: {
      chainId: 1,
      sellToken: overrides.sellToken ?? USDC,
      buyToken: WETH,
      order: { type: "sell", sellAmount: AMOUNT_IN },
      config: { slippagePercentage: 0.5, timeout: "10s", txValidFor: "1h" },
      accounts: {
        takeFrom: SWAPPER,
        recipient: "recipient" in overrides ? overrides.recipient : VAULT,
      },
      external: {},
    },
  } as any)
  return { fetch, result }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW_MS)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Cleave quote source", () => {
  it("requests an exact-in partner quote paying the Euler recipient", async () => {
    const { fetch, result } = quoteWith(quoteBody())
    await result
    const [url, init] = fetch.mock.calls[0]
    const { origin, pathname, searchParams } = new URL(url)
    expect(`${origin}${pathname}`).toBe(
      "https://api.cleave.fi/partner/v1/quote",
    )
    expect(init.headers).toEqual({ Authorization: "Bearer cq_live_test" })
    expect(init.timeout).toBe("10s")
    expect(Object.fromEntries(searchParams)).toEqual({
      chainId: "1",
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: AMOUNT_IN.toString(),
      slippageBps: "50",
      recipient: VAULT,
      deadline: DEADLINE.toString(),
    })
  })

  it("defaults the recipient to the taker", async () => {
    const { fetch, result } = quoteWith(
      quoteBody({ recipient: SWAPPER }),
      200,
      { recipient: undefined },
    )
    await result
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("recipient")).toBe(
      SWAPPER,
    )
  })

  it("returns the net amount, the minimum and the ready transaction", async () => {
    const body = quoteBody()
    const quote = await quoteWith(body).result
    expect(quote).toEqual({
      sellAmount: AMOUNT_IN,
      maxSellAmount: AMOUNT_IN,
      buyAmount: 399960000000000000n,
      minBuyAmount: MIN_OUT,
      type: "sell",
      allowanceTarget: SHELL,
      customData: { tx: { to: SHELL, calldata: body.tx.data, value: 0n } },
    })
    const tx = await new CustomCleaveQuoteSource().buildTx({
      request: { customData: quote.customData },
    } as any)
    expect(tx).toEqual(quote.customData.tx)
  })

  it("refuses native tokens without a request", async () => {
    const { fetch, result } = quoteWith(quoteBody(), 200, {
      sellToken: Addresses.NATIVE_TOKEN,
    })
    await expect(result).rejects.toThrow(/ERC-20/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ["no route", { status: "no_route", reason: "no_pools" }],
    ["a non-ok status with a transaction", quoteBody({}, { status: "x" })],
    [
      "a preferred measured execution",
      quoteBody({}, { preferredExecution: "measured" }),
    ],
    ["no ready transaction", quoteBody({}, { tx: null })],
    ["no minimum", quoteBody({}, { minOut: null })],
    ["a missing partial", quoteBody({}, { partial: undefined })],
    ["a missing refused amount", quoteBody({}, { partial: {} })],
    [
      "a partly refused input",
      quoteBody({}, { partial: { refusedAtSource: "5" } }),
    ],
    ["missing remainders", quoteBody({}, { remainders: undefined })],
    [
      "leftover intermediate tokens",
      quoteBody({}, { remainders: [{ token: USDC, shareWad: "1" }] }),
    ],
    ["another amount", quoteBody({ amountIn: AMOUNT_IN - 1n })],
    ["another tokenIn", quoteBody({ tokenIn: DAI })],
    ["another tokenOut", quoteBody({ tokenOut: DAI })],
    ["another recipient", quoteBody({ recipient: SWAPPER })],
    ["another deadline", quoteBody({ deadline: DEADLINE + 1n })],
    ["another minimum", quoteBody({ minAmountOut: MIN_OUT - 1n })],
    ["native mode", quoteBody({ wethAsErc20: false })],
    [
      "a native value",
      quoteBody({}, { tx: { to: SHELL, data: swapData(), value: "1" } }),
    ],
    [
      "another approval spender",
      quoteBody({}, { execution: { approval: { spender: VAULT } } }),
    ],
    ["no approval", quoteBody({}, { execution: { approval: null } })],
    [
      "other calldata",
      quoteBody({}, { tx: { to: SHELL, data: "0xab33b1ec00", value: "0" } }),
    ],
  ])("fails on %s", async (_, body) => {
    await expect(quoteWith(body).result).rejects.toThrow(/not executable/)
  })

  it("fails on an HTTP error", async () => {
    const { result } = quoteWith({ error: { code: "rate_limited" } }, 429)
    await expect(result).rejects.toThrow(/rate_limited/)
  })

  it("quotes only with an API key", () => {
    const source = new CustomCleaveQuoteSource()
    expect(source.isConfigAndContextValidForQuoting({})).toBe(false)
    expect(source.isConfigAndContextValidForQuoting({ apiKey: "" })).toBe(false)
    expect(source.isConfigAndContextValidForQuoting({ apiKey: "k" })).toBe(true)
  })

  it("supports sell orders on its chains", () => {
    const { supports } = new CustomCleaveQuoteSource().getMetadata()
    expect(supports.buyOrders).toBe(false)
    expect(supports.swapAndTransfer).toBe(true)
    expect(supports.chains).toEqual([1, 10, 56, 137, 8453, 42161])
  })
})

describe("Cleave source registration", () => {
  it("is offered by the aggregators strategy on Cleave chains", async () => {
    const tokenLists = await import("../common/utils/tokenList")
    vi.spyOn(tokenLists, "getAllTokenLists").mockReturnValue({
      1: [],
      56: [],
      146: [],
      8453: [],
      42161: [],
    })
    const { StrategyAggregators } = await import(
      "../swapService/strategies/strategyAggregators"
    )
    const strategy = new StrategyAggregators()
    for (const chainId of [1, 56, 8453, 42161]) {
      expect(await strategy.providers(chainId)).toContain("cleave")
    }
    expect(await strategy.providers(146)).not.toContain("cleave")
  })
})
