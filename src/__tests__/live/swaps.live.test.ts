import { spawn } from "node:child_process"
import { once } from "node:events"
import { type Server, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import dotenv from "dotenv"
import {
  type EulerSDK,
  type SubAccount,
  type SwapQuote,
  SwapperMode,
  type TransactionPlanItem,
  type VaultEntity,
  buildEulerSDK,
  decodeSmartContractErrors,
  getSubAccountAddress,
} from "euler-v2-sdk"
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  parseAbiParameters,
  parseEther,
  parseUnits,
  zeroAddress,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet } from "viem/chains"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { MAINNET_ERC4626_CASES } from "./mainnetErc4626Cases"

const CHAIN_ID = mainnet.id
const ANVIL_HOST = "127.0.0.1"
const FORK_ACCOUNT_PRIVATE_KEY =
  "0x1234567890123456789012345678901234567890123456789012345678901235" as Hex

const USDC_ADDRESS = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
const USDT_ADDRESS = getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7")
const WETH_ADDRESS = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")
const WSTETH_ADDRESS = getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0")

const EULER_PRIME_USDC_VAULT = getAddress(
  "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9",
)
const EULER_PRIME_USDT_VAULT = getAddress(
  "0x313603FA690301b0CaeEf8069c065862f9162162",
)
const WSTETH_VAULT = getAddress("0xbC4B4AC47582c3E38Ce5940B80Da65401F4628f1")

const USDC_WHALE = getAddress("0xb7cD010b53D23a794d754886C3b928BE6a3315dC")
const USDT_WHALE = getAddress("0x83A32a54D31Ee4f1f9dFFAd2A63A6d214e469eC3")
const WETH_WHALE = getAddress("0x4a18a50a8328b42773268B4b436254056b7d70CE")

let anvilProcess: ReturnType<typeof spawn> | undefined
let appServer: Server | undefined
let anvilUrl = ""
let swapApiUrl = ""
let baseSnapshotId!: Hex
let sdk!: EulerSDK

const account = privateKeyToAccount(FORK_ACCOUNT_PRIVATE_KEY)
let walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http("http://127.0.0.1:8545"),
})
let publicClient = createPublicClient({
  chain: mainnet,
  transport: http("http://127.0.0.1:8545"),
})
let testClient = createTestClient({
  chain: mainnet,
  mode: "anvil",
  transport: http("http://127.0.0.1:8545"),
})

describe.sequential("mainnet live swap flows", () => {
  beforeAll(async () => {
    dotenv.config({ path: ".env" })

    const forkRpcUrl = process.env.RPC_URL_1
    if (!forkRpcUrl) {
      throw new Error("RPC_URL_1 is required to run live swap fork tests")
    }

    const anvilPort = await getFreePort()
    anvilUrl = `http://${ANVIL_HOST}:${anvilPort}`

    const anvil = spawn(
      "/Users/dariusz/.foundry/bin/anvil",
      [
        "--fork-url",
        forkRpcUrl,
        "--auto-impersonate",
        "--host",
        ANVIL_HOST,
        "--port",
        String(anvilPort),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    anvilProcess = anvil

    const anvilErrors: string[] = []
    anvil.stderr.on("data", (chunk) => {
      anvilErrors.push(String(chunk))
    })

    await waitForRpc(anvilUrl).catch((error) => {
      throw new Error(
        `Anvil failed to start on ${anvilUrl}: ${error}\n${anvilErrors.join("")}`,
      )
    })

    walletClient = createWalletClient({
      account,
      chain: mainnet,
      transport: http(anvilUrl),
    })
    publicClient = createPublicClient({
      chain: mainnet,
      transport: http(anvilUrl),
    })
    testClient = createTestClient({
      chain: mainnet,
      mode: "anvil",
      transport: http(anvilUrl),
    })

    process.env.RPC_URL_1 = anvilUrl

    const [{ buildCache }, { refreshContractBookAddresses }, { app }] =
      await Promise.all([
        import("@/common/utils/tokenList"),
        import("@/common/utils/contractBook"),
        import("@/server"),
      ])

    await refreshContractBookAddresses().catch(() => undefined)
    await buildCache()

    appServer = createServer(app)
    appServer.listen(0)
    await once(appServer, "listening")
    swapApiUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`

    sdk = await buildEulerSDK({
      rpcUrls: { [CHAIN_ID]: anvilUrl },
      swapServiceConfig: {
        swapApiUrl,
      },
    })

    await initBalances()
    baseSnapshotId = await testClient.snapshot()
  }, 180_000)

  beforeEach(async () => {
    await testClient.revert({ id: baseSnapshotId })
    baseSnapshotId = await testClient.snapshot()
  })

  afterAll(async () => {
    if (appServer) {
      await new Promise<void>((resolve, reject) => {
        appServer?.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }

    if (anvilProcess && !anvilProcess.killed) {
      anvilProcess.kill("SIGTERM")
      await once(anvilProcess, "exit").catch(() => undefined)
    }
  })

  it("opens a position with exact input swap, then fully closes debt with target debt", async () => {
    const subAccountId = 1
    const subAccountAddress = getSubAccountAddress(
      account.address,
      subAccountId,
    )
    const depositAmount = parseUnits("1500", 6)
    const collateralSwapAmount = parseUnits("1000", 6)
    const borrowAmount = parseUnits("100", 6)

    const accountData = (
      await sdk.accountService.fetchAccount(CHAIN_ID, account.address, {
        populateVaults: false,
      })
    ).result

    const depositPlan = await sdk.executionService.resolveRequiredApprovals({
      plan: sdk.executionService.planDeposit({
        account: accountData,
        vault: EULER_PRIME_USDC_VAULT,
        amount: depositAmount,
        receiver: subAccountAddress,
        asset: USDC_ADDRESS,
        enableCollateral: true,
      }),
      chainId: CHAIN_ID,
      account: account.address,
      usePermit2: false,
      unlimitedApproval: false,
    })

    await executePlan(depositPlan)

    const afterDeposit = await fetchSubAccount(subAccountAddress, [
      EULER_PRIME_USDC_VAULT,
      WSTETH_VAULT,
    ])
    expect(getAssets(afterDeposit, EULER_PRIME_USDC_VAULT)).toBeGreaterThan(0n)

    accountData.updateSubAccounts(afterDeposit)

    const collateralQuote = pickQuote(
      await sdk.swapService.getDepositQuote({
        chainId: CHAIN_ID,
        fromVault: EULER_PRIME_USDC_VAULT,
        toVault: WSTETH_VAULT,
        fromAccount: subAccountAddress,
        toAccount: subAccountAddress,
        fromAsset: USDC_ADDRESS,
        toAsset: WSTETH_ADDRESS,
        amount: collateralSwapAmount,
        origin: account.address,
        slippage: 0.5,
        deadline: getDeadline(),
      }),
    )

    await executePlan(
      sdk.executionService.planSwapCollateral({
        account: accountData,
        swapQuote: collateralQuote,
      }),
    )

    const afterSwap = await fetchSubAccount(subAccountAddress, [
      EULER_PRIME_USDC_VAULT,
      WSTETH_VAULT,
    ])
    expect(getAssets(afterSwap, WSTETH_VAULT)).toBeGreaterThan(0n)

    accountData.updateSubAccounts(afterSwap)

    const borrowPlan = await sdk.executionService.resolveRequiredApprovals({
      plan: sdk.executionService.planBorrow({
        account: accountData,
        vault: EULER_PRIME_USDT_VAULT,
        amount: borrowAmount,
        borrowAccount: subAccountAddress,
        receiver: account.address,
      }),
      chainId: CHAIN_ID,
      account: account.address,
      usePermit2: false,
      unlimitedApproval: false,
    })

    await executePlan(borrowPlan)

    const afterBorrow = await fetchSubAccount(subAccountAddress, [
      WSTETH_VAULT,
      EULER_PRIME_USDT_VAULT,
    ])
    const currentDebt = getBorrowed(afterBorrow, EULER_PRIME_USDT_VAULT)
    expect(currentDebt).toBeGreaterThan(0n)

    accountData.updateSubAccounts(afterBorrow)

    const repayQuote = pickQuote(
      await sdk.swapService.getRepayQuotes({
        chainId: CHAIN_ID,
        fromVault: WSTETH_VAULT,
        fromAsset: WSTETH_ADDRESS,
        fromAccount: subAccountAddress,
        liabilityVault: EULER_PRIME_USDT_VAULT,
        liabilityAsset: USDT_ADDRESS,
        liabilityAmount: currentDebt,
        currentDebt,
        toAccount: subAccountAddress,
        origin: account.address,
        swapperMode: SwapperMode.TARGET_DEBT,
        slippage: 0.5,
        deadline: getDeadline(),
      }),
    )

    await executePlan(
      sdk.executionService.planRepayWithSwap({
        account: accountData,
        swapQuote: repayQuote,
      }),
    )

    const afterRepay = await fetchSubAccount(subAccountAddress, [
      WSTETH_VAULT,
      EULER_PRIME_USDT_VAULT,
    ])

    expect(getBorrowed(afterRepay, EULER_PRIME_USDT_VAULT)).toBe(0n)
  }, 180_000)

  it("repays debt with exact input collateral swap", async () => {
    const subAccountId = 2
    const subAccountAddress = getSubAccountAddress(
      account.address,
      subAccountId,
    )
    const collateralAmount = parseUnits("1500", 6)
    const borrowAmount = parseUnits("500", 6)
    const exactInputRepayAmount = parseUnits("300", 6)

    const accountData = (
      await sdk.accountService.fetchAccount(CHAIN_ID, account.address, {
        populateVaults: false,
      })
    ).result

    const borrowPlan = await sdk.executionService.resolveRequiredApprovals({
      plan: sdk.executionService.planBorrow({
        account: accountData,
        vault: EULER_PRIME_USDT_VAULT,
        amount: borrowAmount,
        borrowAccount: subAccountAddress,
        receiver: account.address,
        collateral: {
          vault: EULER_PRIME_USDC_VAULT,
          amount: collateralAmount,
          asset: USDC_ADDRESS,
        },
      }),
      chainId: CHAIN_ID,
      account: account.address,
      usePermit2: false,
      unlimitedApproval: false,
    })

    await executePlan(borrowPlan)

    const afterBorrow = await fetchSubAccount(subAccountAddress, [
      EULER_PRIME_USDC_VAULT,
      EULER_PRIME_USDT_VAULT,
    ])
    const initialDebt = getBorrowed(afterBorrow, EULER_PRIME_USDT_VAULT)
    expect(initialDebt).toBeGreaterThan(0n)

    accountData.updateSubAccounts(afterBorrow)

    const repayQuote = pickQuote(
      await sdk.swapService.getRepayQuotes({
        chainId: CHAIN_ID,
        fromVault: EULER_PRIME_USDC_VAULT,
        fromAsset: USDC_ADDRESS,
        fromAccount: subAccountAddress,
        liabilityVault: EULER_PRIME_USDT_VAULT,
        liabilityAsset: USDT_ADDRESS,
        collateralAmount: exactInputRepayAmount,
        currentDebt: initialDebt,
        toAccount: subAccountAddress,
        origin: account.address,
        swapperMode: SwapperMode.EXACT_IN,
        slippage: 0.5,
        deadline: getDeadline(),
      }),
    )

    await executePlan(
      sdk.executionService.planRepayWithSwap({
        account: accountData,
        swapQuote: repayQuote,
      }),
    )

    const afterRepay = await fetchSubAccount(subAccountAddress, [
      EULER_PRIME_USDC_VAULT,
      EULER_PRIME_USDT_VAULT,
    ])
    const remainingDebt = getBorrowed(afterRepay, EULER_PRIME_USDT_VAULT)

    expect(remainingDebt).toBeGreaterThan(0n)
    expect(remainingDebt).toBeLessThan(initialDebt)
  }, 180_000)

  it("quotes all configured mainnet ERC4626 routes", async () => {
    const subAccountAddress = getSubAccountAddress(account.address, 3)
    const failures: string[] = []

    for (const route of MAINNET_ERC4626_CASES) {
      try {
        const assetDecimals = await readDecimals(route.asset)
        const vaultDecimals = await readDecimals(route.vault)

        const depositQuotes = await sdk.swapService.getDepositQuote({
          chainId: CHAIN_ID,
          fromVault: zeroAddress,
          toVault: route.vault,
          fromAccount: zeroAddress,
          toAccount: subAccountAddress,
          fromAsset: route.asset,
          toAsset: route.vault,
          amount: 10n ** BigInt(assetDecimals),
          origin: account.address,
          slippage: 0.5,
          deadline: getDeadline(),
          unusedInputReceiver: account.address,
        })

        expect(depositQuotes.length).toBeGreaterThan(0)

        const redeemQuotes = await sdk.swapService.getSwapQuotes({
          chainId: CHAIN_ID,
          tokenIn: route.vault,
          tokenOut: route.asset,
          vaultIn: route.vault,
          receiver: route.assetDustEVault,
          accountIn: subAccountAddress,
          accountOut: subAccountAddress,
          amount: 10n ** BigInt(vaultDecimals),
          origin: account.address,
          slippage: 0.5,
          swapperMode: SwapperMode.EXACT_IN,
          isRepay: false,
          targetDebt: 0n,
          currentDebt: 0n,
          deadline: getDeadline(),
        })

        expect(redeemQuotes.length).toBeGreaterThan(0)
      } catch (error) {
        failures.push(`${route.protocol}: ${String(error)}`)
      }
    }

    expect(failures).toEqual([])
  }, 240_000)
})

function getDeadline() {
  return Math.floor(Date.now() / 1000) + 1800
}

function pickQuote(quotes: SwapQuote[]) {
  const filtered =
    quotes.find((quote) => {
      return (
        !quote.route.some((route) => route.providerName.includes("CoW")) &&
        !hasZeroApproveTarget(quote)
      )
    }) ??
    quotes.find((quote) => !hasZeroApproveTarget(quote)) ??
    quotes[0]

  if (!filtered) {
    throw new Error("No swap quote returned")
  }

  return filtered
}

function hasZeroApproveTarget(quote: SwapQuote) {
  return quote.swap.multicallItems.some((item) => {
    if (item.functionName !== "swap") return false

    const swapArgs = item.args[0] as { data?: Hex } | undefined
    if (!swapArgs?.data) return false

    try {
      const [, innerCallData] = decodeAbiParameters(
        parseAbiParameters("address, bytes"),
        swapArgs.data,
      )
      const decoded = decodeFunctionData({
        abi: [
          {
            type: "function",
            name: "approve",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [],
          },
        ],
        data: innerCallData,
      })

      return (
        decoded.functionName === "approve" &&
        isAddressEqual(decoded.args[0] as Address, zeroAddress)
      )
    } catch {
      return false
    }
  })
}

async function executePlan(plan: TransactionPlanItem[]) {
  try {
    for (const item of plan) {
      if (item.type === "requiredApproval") {
        for (const resolved of item.resolved ?? []) {
          if (resolved.type !== "approve") continue

          const hash = await walletClient.sendTransaction({
            account: walletClient.account!,
            chain: mainnet,
            to: resolved.token,
            data: resolved.data,
          })

          await publicClient.waitForTransactionReceipt({ hash })
        }
        continue
      }

      if (item.type !== "evcBatch") continue

      const deployment = sdk.deploymentService.getDeployment(CHAIN_ID)
      const batchData = sdk.executionService.encodeBatch(item.items)
      const totalValue = item.items.reduce((sum, batchItem) => {
        return sum + batchItem.value
      }, 0n)

      const gas = await publicClient.estimateGas({
        account: walletClient.account!.address,
        to: deployment.addresses.coreAddrs.evc,
        data: batchData,
        value: totalValue,
      })

      const hash = await walletClient.sendTransaction({
        account: walletClient.account!,
        chain: mainnet,
        to: deployment.addresses.coreAddrs.evc,
        data: batchData,
        value: totalValue,
        gas: (gas * 120n) / 100n,
      })

      await publicClient.waitForTransactionReceipt({ hash })
    }
  } catch (error) {
    const decodedErrors = await decodeSmartContractErrors(error)
    if (decodedErrors.length > 0) {
      throw new Error(JSON.stringify(decodedErrors, null, 2))
    }
    throw error
  }
}

async function fetchSubAccount(accountAddress: Address, vaults: Address[]) {
  const response = await sdk.accountService.fetchSubAccount(
    CHAIN_ID,
    accountAddress,
    vaults,
    { populateVaults: false },
  )

  if (!response.result) {
    throw new Error(`Sub-account ${accountAddress} not found`)
  }

  return response.result
}

function getAssets(subAccount: SubAccount<VaultEntity>, vault: Address) {
  const position = subAccount.positions.find((entry) => {
    return isAddressEqual(entry.vaultAddress, vault)
  })
  return position?.assets ?? 0n
}

function getBorrowed(subAccount: SubAccount<VaultEntity>, vault: Address) {
  const position = subAccount.positions.find((entry) => {
    return isAddressEqual(entry.vaultAddress, vault)
  })
  return position?.borrowed ?? 0n
}

async function readDecimals(token: Address) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
  })
}

async function initBalances() {
  await testClient.setBalance({
    address: account.address,
    value: parseEther("1000"),
  })

  for (const whale of [USDC_WHALE, USDT_WHALE, WETH_WHALE]) {
    await testClient.setBalance({
      address: whale,
      value: parseEther("10"),
    })
  }

  await transferTokenFromWhale(
    USDC_WHALE,
    USDC_ADDRESS,
    account.address,
    parseUnits("100000", 6),
  )
  await transferTokenFromWhale(
    USDT_WHALE,
    USDT_ADDRESS,
    account.address,
    parseUnits("10000", 6),
  )
  await transferTokenFromWhale(
    WETH_WHALE,
    WETH_ADDRESS,
    account.address,
    parseUnits("1000", 18),
  )
}

async function transferTokenFromWhale(
  whale: Address,
  token: Address,
  recipient: Address,
  amount: bigint,
) {
  const whaleWallet = createWalletClient({
    account: whale,
    chain: mainnet,
    transport: http(anvilUrl),
  })

  const hash = await whaleWallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amount],
  })

  await publicClient.waitForTransactionReceipt({ hash })
}

async function waitForRpc(url: string, retries = 60) {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(url),
  })

  for (let i = 0; i < retries; i += 1) {
    try {
      await client.getBlockNumber()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`JSON-RPC endpoint ${url} did not become ready`)
}

async function getFreePort() {
  const server = createServer()
  server.listen(0, ANVIL_HOST)
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return port
}
