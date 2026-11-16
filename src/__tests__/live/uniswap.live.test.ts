import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { Addresses } from "@balmy/sdk"
import { buildFetchService } from "@balmy/sdk/dist/sdk/builders/fetch-builder"
import type { QuoteParams } from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import dotenv from "dotenv"
import {
  http,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeFunctionData,
  erc20Abi,
  isAddressEqual,
  parseAbi,
  parseEther,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet } from "viem/chains"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { CustomUniswapQuoteSource } from "../../swapService/strategies/aggregators/sources/uniswapQuoteSource"

dotenv.config()
const source = new CustomUniswapQuoteSource()
const swapper = "0x8A54C278D117854486dB0F6460D901A180fFf5aa"
const recipient = "0x313603FA690301b0CaeEf8069c065862f9162162"
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const pairs = [
  [1, usdc, weth, 6],
  [
    10,
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    "0x4200000000000000000000000000000000000006",
    6,
  ],
  [
    56,
    "0x55d398326f99059ff775485246999027b3197955",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    18,
  ],
  [
    130,
    "0x078d782b760474a361dda0af3839290b0ef57ad6",
    "0x4200000000000000000000000000000000000006",
    6,
  ],
  [
    137,
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    6,
  ],
  [
    8453,
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0x4200000000000000000000000000000000000006",
    6,
  ],
  [
    42161,
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    6,
  ],
  [
    42220,
    "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    "0x471ece3750da237f93b8e339c536989b8978a438",
    6,
  ],
  [
    43114,
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
    6,
  ],
] as const

function params(
  chainId: number,
  sellToken: string,
  buyToken: string,
  order: QuoteParams<{
    buyOrders: true
    swapAndTransfer: true
  }>["request"]["order"],
) {
  return {
    components: { fetchService: buildFetchService() },
    config: { apiKey: process.env.UNISWAP_API_KEY! },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: {
        takeFrom: swapper,
        recipient: order.type === "buy" ? swapper : recipient,
      },
      config: { slippagePercentage: 1, timeout: "30s", txValidFor: "20m" },
    },
  } as unknown as Parameters<typeof source.quote>[0]
}

describe.sequential("Uniswap live quote and transaction construction", () => {
  beforeAll(() => {
    if (!process.env.UNISWAP_API_KEY)
      throw new Error("UNISWAP_API_KEY is required")
    expect(pairs.map(([id]) => id).sort((a, b) => a - b)).toEqual(
      [...source.getMetadata().supports.chains].sort((a, b) => a - b),
    )
  })

  it.each(pairs)(
    "quotes and builds a direct-approval swap on chain %i",
    async (chainId, tokenIn, tokenOut, decimals) => {
      const request = params(chainId, tokenIn, tokenOut, {
        type: "sell",
        sellAmount: 100n * 10n ** BigInt(decimals),
      })
      const quote = await source.quote(request)
      expect(quote.buyAmount).toBeGreaterThan(0n)
      expect(quote.minBuyAmount).toBeLessThan(quote.buyAmount)
      expect(quote.sellAmount).toBe(quote.maxSellAmount)
      expect(quote.customData.tx.calldata.length).toBeGreaterThan(10)
      expect(quote.customData.tx.value).toBe(0n)
      // Check the API's actual ERC-20 spender, independently of swap.to.
      const response = await fetch(
        "https://trade-api.gateway.uniswap.org/v1/check_approval",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.UNISWAP_API_KEY!,
            "x-permit2-disabled": "true",
          },
          body: JSON.stringify({
            chainId,
            walletAddress: recipient,
            token: tokenIn,
            amount: quote.maxSellAmount.toString(),
          }),
          signal: AbortSignal.timeout(30000),
        },
      )
      expect(response.status).toBe(200)
      const { approval } = await response.json()
      expect(approval).not.toBeNull()
      const decoded = decodeFunctionData({ abi: erc20Abi, data: approval.data })
      expect(decoded.functionName).toBe("approve")
      expect(
        isAddressEqual(
          decoded.args![0] as `0x${string}`,
          quote.allowanceTarget as `0x${string}`,
        ),
      ).toBe(true)
      // Stay below the developer key's default request rate.
      await new Promise((resolve) => setTimeout(resolve, 550))
    },
    90000,
  )

  it("accepts Euler slippage with more than two decimal places", async () => {
    const request = params(1, usdc, weth, {
      type: "sell",
      sellAmount: 100n * 10n ** 6n,
    })
    request.request.config.slippagePercentage = 1.234
    const quote = await source.quote(request)
    expect(quote.minBuyAmount).toBeGreaterThanOrEqual(
      (quote.buyAmount * 98766n) / 100000n,
    )
  }, 60000)

  it("quotes an exact-output swap with a bounded maximum input", async () => {
    const quote = await source.quote(
      params(1, usdc, weth, { type: "buy", buyAmount: 10n ** 16n }),
    )
    expect(quote.buyAmount).toBe(10n ** 16n)
    expect(quote.minBuyAmount).toBe(quote.buyAmount)
    expect(quote.maxSellAmount).toBeGreaterThan(quote.sellAmount)
  }, 60000)

  it("builds native-input calldata with the correct value", async () => {
    const quote = await source.quote(
      params(1, Addresses.NATIVE_TOKEN, usdc, {
        type: "sell",
        sellAmount: 10n ** 16n,
      }),
    )
    expect(quote.customData.tx.value).toBe(10n ** 16n)
    expect(quote.allowanceTarget).toBe(Addresses.ZERO_ADDRESS)
  }, 60000)

  it("builds native-output calldata for a distinct recipient", async () => {
    const quote = await source.quote(
      params(1, usdc, Addresses.NATIVE_TOKEN, {
        type: "sell",
        sellAmount: 100n * 10n ** 6n,
      }),
    )
    expect(quote.customData.tx.value).toBe(0n)
    expect(quote.minBuyAmount).toBeGreaterThan(0n)
  }, 60000)
})

describe.sequential("Uniswap mainnet fork execution", () => {
  // Public test key, used exclusively against the Anvil instance started below.
  const account = privateKeyToAccount(
    "0x1234567890123456789012345678901234567890123456789012345678901235",
  )
  const receiver = "0x000000000000000000000000000000000000bEEF"
  let anvil: ReturnType<typeof spawn> | undefined
  let publicClient: ReturnType<typeof createPublicClient>
  let testClient: ReturnType<typeof createTestClient>
  let wallet: ReturnType<typeof createWalletClient>
  let snapshot: Hex

  beforeAll(async () => {
    if (!process.env.UNISWAP_API_KEY || !process.env.RPC_URL_1) {
      throw new Error(
        "UNISWAP_API_KEY and RPC_URL_1 are required for the fork suite",
      )
    }
    const portServer = createServer()
    portServer.listen(0, "127.0.0.1")
    await once(portServer, "listening")
    const { port } = portServer.address() as { port: number }
    await new Promise<void>((resolve) => portServer.close(() => resolve()))
    const url = `http://127.0.0.1:${port}`
    anvil = spawn(
      process.env.ANVIL_BIN || "anvil",
      [
        "--fork-url",
        process.env.RPC_URL_1,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--hardfork",
        "osaka",
        "--auto-impersonate",
        "--silent",
      ],
      { stdio: "ignore" },
    )
    let startupError: Error | undefined
    anvil.on("error", (error) => {
      startupError = error
    })
    publicClient = createPublicClient({
      chain: mainnet,
      transport: http(url, { retryCount: 0 }),
    })
    testClient = createTestClient({
      chain: mainnet,
      mode: "anvil",
      transport: http(url),
    })
    wallet = createWalletClient({
      chain: mainnet,
      account,
      transport: http(url),
    })
    for (let i = 0; i < 60; i++) {
      if (startupError) throw startupError
      try {
        await publicClient.getBlockNumber()
        break
      } catch {
        if (i === 59) throw new Error("Local Anvil did not start")
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    await testClient.setBalance({
      address: account.address,
      value: parseEther("100"),
    })
    await mined(
      await wallet.writeContract({
        chain: mainnet,
        account,
        address: weth,
        abi: parseAbi(["function deposit() payable"]),
        functionName: "deposit",
        value: parseEther("10"),
      }),
    )
    const whale = "0xbcca60bb61934080951369a648fb03df4f96263c"
    await testClient.setBalance({ address: whale, value: parseEther("10") })
    await mined(
      await wallet.writeContract({
        chain: mainnet,
        account: whale,
        address: usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [account.address, 10000n * 10n ** 6n],
      }),
    )
    snapshot = await testClient.snapshot()
  }, 120000)

  beforeEach(async () => {
    await testClient.revert({ id: snapshot })
    snapshot = await testClient.snapshot()
  })

  afterAll(async () => {
    if (anvil && anvil.exitCode === null && !anvil.killed) {
      const exited = once(anvil, "exit")
      anvil.kill("SIGTERM")
      await exited
    }
  })

  async function mined(hash: Hex) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe("success")
  }

  const cases = [
    {
      name: "ERC-20 exact input",
      sellToken: weth,
      buyToken: usdc,
      order: { type: "sell", sellAmount: parseEther("0.1") },
    },
    {
      name: "ERC-20 exact output and unused input",
      sellToken: weth,
      buyToken: usdc,
      order: { type: "buy", buyAmount: 100n * 10n ** 6n },
    },
    {
      name: "native input",
      sellToken: Addresses.NATIVE_TOKEN,
      buyToken: usdc,
      order: { type: "sell", sellAmount: parseEther("0.1") },
    },
    {
      name: "native output to a distinct recipient",
      sellToken: usdc,
      buyToken: Addresses.NATIVE_TOKEN,
      order: { type: "sell", sellAmount: 100n * 10n ** 6n },
    },
  ] as const

  it.each(cases)(
    "executes $name",
    async ({ sellToken, buyToken, order }) => {
      const outputReceiver = order.type === "buy" ? account.address : receiver
      const request = params(1, sellToken, buyToken, order)
      request.request.accounts = {
        takeFrom: account.address,
        recipient: outputReceiver,
      }
      const quote = await source.quote(request)
      const inputBefore = await balance(sellToken, account.address)
      const outputBefore = await balance(buyToken, outputReceiver)
      if (sellToken !== Addresses.NATIVE_TOKEN) {
        await mined(
          await wallet.writeContract({
            chain: mainnet,
            account,
            address: sellToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.allowanceTarget as Hex, quote.maxSellAmount],
          }),
        )
      }
      const tx = quote.customData.tx
      await mined(
        await wallet.sendTransaction({
          chain: mainnet,
          account,
          to: tx.to as Hex,
          data: tx.calldata as Hex,
          value: tx.value,
        }),
      )
      const received = (await balance(buyToken, outputReceiver)) - outputBefore
      expect(received).toBeGreaterThanOrEqual(quote.minBuyAmount)
      if (order.type === "buy") expect(received).toBe(order.buyAmount)
      if (sellToken !== Addresses.NATIVE_TOKEN) {
        const spent = inputBefore - (await balance(sellToken, account.address))
        expect(spent).toBeGreaterThan(0n)
        expect(spent).toBeLessThanOrEqual(quote.maxSellAmount)
        if (order.type === "sell") expect(spent).toBe(order.sellAmount)
        else
          expect(inputBefore - spent).toBeGreaterThan(
            inputBefore - quote.maxSellAmount,
          )
      }
    },
    90000,
  )

  async function balance(token: string, owner: Hex) {
    return token === Addresses.NATIVE_TOKEN
      ? publicClient.getBalance({ address: owner })
      : publicClient.readContract({
          address: token as Hex,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        })
  }
})
