import { Addresses } from "@balmy/sdk"
import { describe, expect, it, vi } from "vitest"
import { CustomMooseQuoteSource } from "../swapService/strategies/aggregators/sources/mooseQuoteSource"

const MONAD = 143
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"
const AGGREGATOR = "0xD1B844a2443704bcB2f737a7434513437438B65e"

const mooseResponse = {
  quote: { amountOut: "15346", minAmountOut: "15269" },
  transaction: {
    to: AGGREGATOR,
    data: "0xabcdef",
    value: "0xde0b6b3a7640000",
    gas: "0x621c44",
  },
  spender: AGGREGATOR,
}

type QuoteParams = Parameters<CustomMooseQuoteSource["quote"]>[0]

const setup = (
  response: unknown = { ok: true, json: async () => mooseResponse },
) => {
  const fetch = vi.fn(async () => response)
  const params = (
    sellToken: string,
    buyToken: string,
    slippagePercentage = 0.5,
  ) =>
    ({
      components: { fetchService: { fetch } },
      request: {
        chainId: MONAD,
        sellToken,
        buyToken,
        order: { type: "sell", sellAmount: 10n ** 18n },
        config: { slippagePercentage, timeout: "5s" },
        accounts: { takeFrom: AGGREGATOR },
      },
      config: {},
    }) as unknown as QuoteParams
  return { fetch, params, source: new CustomMooseQuoteSource() }
}

describe("Moose quote source", () => {
  it("serves exact-input swaps on Monad without transferring to a receiver", () => {
    const { supports } = new CustomMooseQuoteSource().getMetadata()
    expect(supports).toEqual({
      chains: [MONAD],
      swapAndTransfer: false,
      buyOrders: false,
    })
  })

  it("requests a quote with the zero address for native MON and slippage in bps", async () => {
    const { fetch, params, source } = setup()
    await source.quote(params(Addresses.NATIVE_TOKEN, USDC))

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.moose.trade/v1/quote")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      tokenIn: Addresses.ZERO_ADDRESS,
      tokenOut: USDC,
      amountIn: "1000000000000000000",
      slippageBps: 50,
    })
  })

  it("maps the response to amounts, gas and the prepared transaction", async () => {
    const { params, source } = setup()
    const quote = await source.quote(params(Addresses.NATIVE_TOKEN, USDC))

    expect(quote).toMatchObject({
      type: "sell",
      sellAmount: 10n ** 18n,
      maxSellAmount: 10n ** 18n,
      buyAmount: 15346n,
      minBuyAmount: 15269n,
      estimatedGas: 6429764n,
      allowanceTarget: Addresses.ZERO_ADDRESS,
      customData: {
        tx: { to: AGGREGATOR, calldata: "0xabcdef", value: 10n ** 18n },
      },
    })
  })

  it("returns the shared spender as the allowance target for an ERC-20 input", async () => {
    const { params, source } = setup({
      ok: true,
      json: async () => ({
        ...mooseResponse,
        transaction: { ...mooseResponse.transaction, value: "0x0" },
      }),
    })
    const quote = await source.quote(params(AUSD, USDC))

    expect(quote.allowanceTarget).toBe(AGGREGATOR)
    expect(quote.customData.tx.value).toBe(0n)
  })

  it("fails with the API error body when no quote is available", async () => {
    const { params, source } = setup({
      ok: false,
      status: 422,
      text: async () => '{"error":{"code":"no_route","retryable":false}}',
    })

    await expect(source.quote(params(AUSD, USDC))).rejects.toThrow(/no_route/)
  })

  it("fails before the request when slippage is above the API maximum", async () => {
    const { fetch, params, source } = setup()

    await expect(source.quote(params(AUSD, USDC, 51))).rejects.toThrow(
      /outside 0 to 5000 bps/,
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
