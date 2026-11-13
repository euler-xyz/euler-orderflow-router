import { Addresses } from "@balmy/sdk"
import type { BuildTxParams } from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import { zeroAddress } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CustomUniswapQuoteSource } from "../swapService/strategies/aggregators/sources/uniswapQuoteSource"

const tokenIn = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const tokenOut = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const swapper = "0x8A54C278D117854486dB0F6460D901A180fFf5aa"
const recipient = "0x313603FA690301b0CaeEf8069c065862f9162162"
const proxyRouter = "0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9"
const source = new CustomUniswapQuoteSource()
type Params = Parameters<typeof source.quote>[0]

function setup() {
  const quote = {
    chainId: 1,
    swapper,
    tradeType: "EXACT_INPUT",
    input: { token: tokenIn, amount: "1000", maximumAmount: "1000" },
    output: { token: tokenOut, recipient, amount: "501", minimumAmount: "495" },
    gasUseEstimate: "163256",
    route: [[{ type: "v3-pool" }]],
    slippage: 1,
    quoteId: "fixture",
    txFailureReasons: ["INSUFFICIENT_BALANCE"],
  }
  const quoteResponse = {
    routing: "CLASSIC",
    permitData: null as unknown,
    quote,
  }
  const swap = {
    to: proxyRouter,
    from: swapper,
    chainId: 1,
    data: "0x2894adf900000000",
    value: "0x00",
  }
  const fetch = vi
    .fn()
    .mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(url.endsWith("/quote") ? quoteResponse : { swap }),
        ),
    )
  const params = {
    components: { fetchService: { fetch } },
    config: { apiKey: "test-key" },
    request: {
      chainId: 1,
      sellToken: tokenIn.toLowerCase(),
      buyToken: tokenOut.toLowerCase(),
      order: { type: "sell", sellAmount: 1000n },
      accounts: { takeFrom: swapper.toLowerCase(), recipient },
      config: { slippagePercentage: 1, timeout: "10s", txValidFor: "20m" },
    },
  } as unknown as Params
  return { params, fetch, quote, quoteResponse, swap }
}

afterEach(() => vi.useRealTimers())

describe("Uniswap Trading API source", () => {
  it("builds direct-approval calldata for an unfunded contract and preserves API bounds", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-13T14:00:00Z"))
    const { params, fetch, quote, swap } = setup()
    const result = await source.quote(params)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe("https://trade-api.gateway.uniswap.org/v1/quote")
    expect(init.method).toBe("POST")
    expect(init.timeout).toBe("10s")
    expect(init.headers).toMatchObject({
      "x-api-key": "test-key",
      "x-permit2-disabled": "true",
      "x-universal-router-version": "2.1.2",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(init.body)).toEqual({
      type: "EXACT_INPUT",
      amount: "1000",
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn,
      tokenOut,
      swapper,
      recipient,
      slippageTolerance: 1,
      protocols: ["V2", "V3", "V4"],
    })
    const [swapUrl, swapInit] = fetch.mock.calls[1]
    expect(swapUrl).toBe("https://trade-api.gateway.uniswap.org/v1/swap")
    expect(swapInit.headers).toEqual(init.headers)
    expect(swapInit.timeout).toBe("10s")
    expect(JSON.parse(swapInit.body)).toEqual({
      quote,
      deadline: Math.floor(Date.now() / 1000) + 1200,
      simulateTransaction: false,
      refreshGasPrice: false,
      safetyMode: "SAFE",
    })
    expect(result).toMatchObject({
      type: "sell",
      sellAmount: 1000n,
      maxSellAmount: 1000n,
      buyAmount: 501n,
      minBuyAmount: 495n,
      estimatedGas: 163256n,
      allowanceTarget: proxyRouter,
    })
    const tx = await source.buildTx({
      request: { customData: result.customData },
    } as BuildTxParams<{ apiKey: string }, typeof result.customData>)
    expect(tx).toEqual({ to: swap.to, calldata: swap.data, value: 0n })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    [1.234, 1.23],
    [1.235, 1.23],
    [0.29, 0.29],
    [0.001, 0],
  ])(
    "normalizes slippage %s to %s without loosening the limit",
    async (requested, expected) => {
      const { params, fetch } = setup()
      params.request.config.slippagePercentage = requested
      await source.quote(params)
      expect(JSON.parse(fetch.mock.calls[0][1].body).slippageTolerance).toBe(
        expected,
      )
    },
  )

  it("uses exact-output amounts and the API's rounded maximum input", async () => {
    const { params, quote, fetch } = setup()
    params.request.order = { type: "buy", buyAmount: 501n }
    params.request.accounts.recipient = swapper
    quote.output.recipient = swapper
    quote.tradeType = "EXACT_OUTPUT"
    quote.input.maximumAmount = "1011"
    quote.output.minimumAmount = "501"
    const result = await source.quote(params)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      type: "EXACT_OUTPUT",
      amount: "501",
    })
    expect(result).toMatchObject({
      type: "buy",
      sellAmount: 1000n,
      maxSellAmount: 1011n,
      buyAmount: 501n,
      minBuyAmount: 501n,
    })
  })

  it("rejects buy orders whose unused input would go to a different recipient", async () => {
    const { params, fetch } = setup()
    params.request.order = { type: "buy", buyAmount: 501n }
    await expect(source.quote(params)).rejects.toThrow(
      "recipient to be the taker",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps native input to zero address and preserves transaction value", async () => {
    const { params, quote, swap, fetch } = setup()
    params.request.sellToken = Addresses.NATIVE_TOKEN
    quote.input.token = zeroAddress
    swap.value = "0x3e8"
    const result = await source.quote(params)
    expect(JSON.parse(fetch.mock.calls[0][1].body).tokenIn).toBe(zeroAddress)
    expect(result.allowanceTarget).toBe(zeroAddress)
    expect(result.customData.tx.value).toBe(1000n)
  })

  it("requests native output directly without a legacy unwrap multicall", async () => {
    const { params, quote, swap, fetch } = setup()
    params.request.buyToken = Addresses.NATIVE_TOKEN
    params.request.accounts.recipient = undefined
    quote.output.token = zeroAddress
    quote.output.recipient = swapper
    const result = await source.quote(params)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      tokenOut: zeroAddress,
      recipient: swapper,
    })
    expect(result.customData.tx.calldata).toBe(swap.data)
  })

  it("rejects native-input buy orders before requesting a quote", async () => {
    const { params, fetch } = setup()
    params.request.sellToken = Addresses.NATIVE_TOKEN
    params.request.order = { type: "buy", buyAmount: 501n }
    await expect(source.quote(params)).rejects.toThrow(
      "buy orders with native token",
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([undefined, {}, { apiKey: "" }, { apiKey: "  " }])(
    "disables quoting without a usable key: %j",
    (config) => {
      expect(source.isConfigAndContextValidForQuoting(config)).toBe(false)
      expect(source.isConfigAndContextValidForTxBuilding(config)).toBe(false)
    },
  )

  it("does not send a request without a key", async () => {
    const { params, fetch } = setup()
    params.config.apiKey = ""
    await expect(source.quote(params)).rejects.toThrow("requires an API key")
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([401, 404, 429, 500])(
    "propagates quote HTTP %i without exposing credentials",
    async (status) => {
      const { params, fetch } = setup()
      fetch.mockResolvedValue(new Response("upstream error", { status }))
      await expect(source.quote(params)).rejects.toThrow(
        `Trading API /quote returned HTTP ${status}`,
      )
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it("propagates transaction-build errors", async () => {
    const { params, fetch } = setup()
    const valid = setup()
    fetch
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify(valid.quoteResponse)))
      .mockResolvedValueOnce(new Response("failed", { status: 500 }))
    await expect(source.quote(params)).rejects.toThrow(
      "Trading API /swap returned HTTP 500",
    )
  })

  it.each(["DUTCH_V3", "WRAP", "BRIDGE", "CHAINED"])(
    "rejects unsupported %s routing",
    async (routing) => {
      const { params, quoteResponse, fetch } = setup()
      quoteResponse.routing = routing
      await expect(source.quote(params)).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects a route requiring a Permit2 signature", async () => {
    const { params, quoteResponse, fetch } = setup()
    quoteResponse.permitData = { domain: {} }
    await expect(source.quote(params)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    "chain",
    "swapper",
    "recipient",
    "token",
    "amount",
    "bounds",
    "zero",
  ])("rejects inconsistent quote %s", async (field) => {
    const { params, quote, fetch } = setup()
    if (field === "chain") quote.chainId = 8453
    if (field === "swapper") quote.swapper = recipient
    if (field === "recipient") quote.output.recipient = swapper
    if (field === "token") quote.input.token = tokenOut
    if (field === "amount") quote.input.amount = "999"
    if (field === "bounds") quote.input.maximumAmount = "1001"
    if (field === "zero") quote.output.minimumAmount = "0"
    await expect(source.quote(params)).rejects.toThrow("inconsistent")
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(["chain", "from", "value", "data", "target"])(
    "rejects invalid swap %s",
    async (field) => {
      const { params, swap } = setup()
      if (field === "chain") swap.chainId = 8453
      if (field === "from") swap.from = recipient
      if (field === "value") swap.value = "1"
      if (field === "data") swap.data = "0x"
      if (field === "target") swap.to = zeroAddress
      await expect(source.quote(params)).rejects.toThrow()
    },
  )
})
