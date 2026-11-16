import { createRequire } from "node:module"
import { Protocol } from "@uniswap/router-sdk"
import { CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core"
import {
  AlphaRouter,
  type RouteWithValidQuote,
  type SwapRoute,
} from "@uniswap/smart-order-router"
import { buildTrade } from "@uniswap/smart-order-router/build/main/util/methodParameters"
import type * as V3SDK from "@uniswap/v3-sdk"
import { BigNumber } from "ethers"
import { type Address, encodePacked, zeroAddress } from "viem"
import { describe, expect, it, vi } from "vitest"
import { SwapperMode } from "../swapService/interface"
import { fetchUniswapQuote } from "../swapService/quoters/quoterUniswap"
import type { SwapParams } from "../swapService/types"

vi.mock("@/common/utils/viemClients", () => ({
  RPC_URLS: { 1: "http://127.0.0.1:1" },
}))

const require = createRequire(import.meta.url)
const routerRequire = createRequire(
  require.resolve("@uniswap/smart-order-router"),
)
const { Pool, Route } = routerRequire("@uniswap/v3-sdk") as typeof V3SDK

const usdc = new Token(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6)
const usdt = new Token(1, "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6)

describe("combined Uniswap exact-output route", () => {
  it("builds an AlphaRouter trade and encodes its V3 repayment path", async () => {
    const pool = new Pool(
      usdc,
      usdt,
      500,
      (2n ** 96n).toString(),
      "1000000000000",
      0,
    )
    const route = new Route([pool], usdc, usdt)
    const quotedRoute = {
      protocol: Protocol.V3,
      route,
      amount: CurrencyAmount.fromRawAmount(usdt, "1000000"),
      quote: CurrencyAmount.fromRawAmount(usdc, "1000501"),
    } as RouteWithValidQuote

    // Exercise AlphaRouter's real SDK composition; mock only the remote quote.
    // Incompatible router/V3 SDK versions throw while constructing this trade.
    const trade = buildTrade(usdc, usdt, TradeType.EXACT_OUTPUT, [quotedRoute])
    const routeSpy = vi
      .spyOn(AlphaRouter.prototype, "route")
      .mockResolvedValue({
        trade,
        estimatedGasUsed: BigNumber.from(100000),
        gasPriceWei: BigNumber.from(1000000000),
      } as SwapRoute)
    const token = (value: Token) => ({
      address: value.address as Address,
      chainId: 1,
      decimals: value.decimals,
      name: "fixture",
      symbol: "fixture",
      logoURI: "",
    })
    const params: SwapParams = {
      chainId: 1,
      tokenIn: token(usdc),
      tokenOut: token(usdt),
      amount: 1000000n,
      swapperMode: SwapperMode.TARGET_DEBT,
      accountIn: zeroAddress,
      accountOut: zeroAddress,
      vaultIn: zeroAddress,
      receiver: zeroAddress,
      origin: zeroAddress,
      from: zeroAddress,
      dustAccount: zeroAddress,
      targetDebt: 0n,
      currentDebt: 1000000n,
      slippage: 0.5,
      deadline: 0,
      isRepay: true,
    }

    const quote = await fetchUniswapQuote(params)

    expect(routeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: expect.objectContaining({ address: usdt.address }),
      }),
      expect.objectContaining({ address: usdc.address }),
      TradeType.EXACT_OUTPUT,
      expect.anything(),
      { protocols: [Protocol.V2, Protocol.V3] },
    )
    expect(quote.amountIn).toBe(1000501n)
    expect(quote.amountOut).toBe(1000000n)
    expect(quote.protocol).toBe("V3")
    expect(quote.data).toBe(
      encodePacked(
        ["address", "uint24", "address"],
        [usdt.address as Address, 500, usdc.address as Address],
      ),
    )
  })
})
