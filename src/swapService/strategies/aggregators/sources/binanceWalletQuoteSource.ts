import crypto from "node:crypto"
import {
  Addresses,
  type ChainId,
  type IFetchService,
  type TimeString,
  type TokenAddress,
} from "@balmy/sdk"
import type {
  BuildTxParams,
  IQuoteSource,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  addQuoteSlippage,
  calculateAllowanceTarget,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import qs from "qs"
import { getAddress, isAddress } from "viem"

const BINANCE_WALLET_BASE_URL = "https://web3.binance.com"
const BINANCE_WALLET_QUOTE_PATH = "/build/api/v1/dex/aggregator/quote"
const BINANCE_WALLET_SWAP_PATH = "/build/api/v1/dex/aggregator/swap"

const DEFAULT_SUPPORTED_CHAINS = [
  1, 10, 56, 137, 42161, 43114, 8453,
] satisfies ChainId[]

type BinanceWalletSupport = { buyOrders: false; swapAndTransfer: false }
type BinanceWalletConfig = {
  apiKey: string
  secretKey: string
}
type BinanceWalletData = {
  quoteId: string
  slippagePercentage: number
}
type BinanceWalletResponse<T> = {
  code?: number
  msg?: string
  data?: T
  success?: boolean
}
type BinanceWalletQuoteRoute = {
  quoteId?: string
  fromTokenAmount?: string
  toTokenAmount?: string
  approveTarget?: string | null
  executionMode?: string
  isBest?: boolean
}
type BinanceWalletSwapData = {
  executionMode?: string
  tx?: {
    to?: string
    data?: string
    value?: string
  }
}

export class CustomBinanceWalletQuoteSource
  implements
    IQuoteSource<BinanceWalletSupport, BinanceWalletConfig, BinanceWalletData>
{
  getMetadata() {
    return {
      name: "Binance Wallet",
      supports: {
        chains: DEFAULT_SUPPORTED_CHAINS,
        swapAndTransfer: false,
        buyOrders: false,
      },
      logoURI: "",
    } as QuoteSourceMetadata<BinanceWalletSupport>
  }

  async quote({
    components: { fetchService },
    request,
    config,
  }: QuoteParams<BinanceWalletSupport, BinanceWalletConfig>): Promise<
    SourceQuoteResponse<BinanceWalletData>
  > {
    const routes = await getQuoteRoutes({
      fetchService,
      request,
      config,
      metadata: this.getMetadata(),
    })
    const route = routes.filter(isSwapRoute).sort(compareQuoteRoutes)[0]

    if (!route) {
      failed(
        this.getMetadata(),
        request.chainId,
        request.sellToken,
        request.buyToken,
        "Binance Wallet quote not found",
      )
    }

    const quoteId = requireString({
      value: route.quoteId,
      field: "quoteId",
      metadata: this.getMetadata(),
      request,
    })
    const toTokenAmount = requireIntegerString({
      value: route.toTokenAmount,
      field: "toTokenAmount",
      metadata: this.getMetadata(),
      request,
    })

    const quote = {
      sellAmount: request.order.sellAmount,
      buyAmount: BigInt(toTokenAmount),
      allowanceTarget: getAllowanceTarget({
        sellToken: request.sellToken,
        approveTarget: route.approveTarget,
        metadata: this.getMetadata(),
        request,
      }),
      customData: {
        quoteId,
        slippagePercentage: request.config.slippagePercentage,
      },
    }

    return addQuoteSlippage(
      quote,
      request.order.type,
      request.config.slippagePercentage,
    )
  }

  async buildTx({
    components: { fetchService },
    request,
    config,
  }: BuildTxParams<
    BinanceWalletConfig,
    BinanceWalletData
  >): Promise<SourceQuoteTransaction> {
    const queryParams = {
      binanceChainId: String(request.chainId),
      amount: request.sellAmount.toString(),
      fromTokenAddress: request.sellToken,
      toTokenAddress: request.buyToken,
      userWalletAddress: request.accounts.takeFrom,
      quoteId: request.customData.quoteId,
      slippagePercent: String(request.customData.slippagePercentage),
      autoSlippage: "false",
    }
    const pathWithQuery = buildPathWithQuery(
      BINANCE_WALLET_SWAP_PATH,
      queryParams,
    )
    const response = await fetchBinance<BinanceWalletSwapData>({
      pathWithQuery,
      method: "GET",
      body: "",
      config,
      fetchService,
      timeout: request.config.timeout,
      metadata: this.getMetadata(),
      chainId: request.chainId,
      sellToken: request.sellToken,
      buyToken: request.buyToken,
    })

    if (response.executionMode && response.executionMode !== "SWAP") {
      failed(
        this.getMetadata(),
        request.chainId,
        request.sellToken,
        request.buyToken,
        `Unsupported Binance Wallet execution mode ${response.executionMode}`,
      )
    }

    const tx = response.tx
    if (!tx) {
      failed(
        this.getMetadata(),
        request.chainId,
        request.sellToken,
        request.buyToken,
        "Missing Binance Wallet swap transaction",
      )
    }

    const to = requireAddress({
      value: tx.to,
      field: "tx.to",
      metadata: this.getMetadata(),
      chainId: request.chainId,
      sellToken: request.sellToken,
      buyToken: request.buyToken,
    })
    const calldata = requireString({
      value: tx.data,
      field: "tx.data",
      metadata: this.getMetadata(),
      chainId: request.chainId,
      sellToken: request.sellToken,
      buyToken: request.buyToken,
    })

    return {
      to,
      calldata,
      value: BigInt(tx.value ?? 0),
    }
  }

  isConfigAndContextValidForQuoting(
    config: Partial<BinanceWalletConfig> | undefined,
  ): config is BinanceWalletConfig {
    return !!config?.apiKey && !!config?.secretKey
  }

  isConfigAndContextValidForTxBuilding(
    config: Partial<BinanceWalletConfig> | undefined,
  ): config is BinanceWalletConfig {
    return !!config?.apiKey && !!config?.secretKey
  }
}

function getQuoteRoutes({
  fetchService,
  request,
  config,
  metadata,
}: {
  fetchService: IFetchService
  request: QuoteParams<BinanceWalletSupport, BinanceWalletConfig>["request"]
  config: BinanceWalletConfig
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
}) {
  const queryParams = {
    binanceChainId: String(request.chainId),
    amount: request.order.sellAmount.toString(),
    fromTokenAddress: request.sellToken,
    toTokenAddress: request.buyToken,
    userWalletAddress: request.accounts.takeFrom,
  }
  const pathWithQuery = buildPathWithQuery(
    BINANCE_WALLET_QUOTE_PATH,
    queryParams,
  )
  return fetchBinance<BinanceWalletQuoteRoute[]>({
    pathWithQuery,
    method: "GET",
    body: "",
    config,
    fetchService,
    timeout: request.config.timeout,
    metadata,
    chainId: request.chainId,
    sellToken: request.sellToken,
    buyToken: request.buyToken,
  })
}

async function fetchBinance<T>({
  pathWithQuery,
  method,
  body,
  config,
  fetchService,
  timeout,
  metadata,
  chainId,
  sellToken,
  buyToken,
}: {
  pathWithQuery: string
  method: "GET"
  body: string
  config: BinanceWalletConfig
  fetchService: IFetchService
  timeout?: TimeString
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
  chainId: ChainId
  sellToken: TokenAddress
  buyToken: TokenAddress
}) {
  const response = await fetchService.fetch(
    `${BINANCE_WALLET_BASE_URL}${pathWithQuery}`,
    {
      timeout,
      headers: getSignedHeaders({ pathWithQuery, method, body, config }),
    },
  )
  const responseText = await response.text()
  let responseBody: BinanceWalletResponse<T> | undefined

  try {
    responseBody = responseText ? JSON.parse(responseText) : undefined
  } catch {
    failed(metadata, chainId, sellToken, buyToken, responseText)
  }

  if (!response.ok) {
    failed(
      metadata,
      chainId,
      sellToken,
      buyToken,
      responseBody?.msg ||
        responseText ||
        `Failed with status ${response.status}`,
    )
  }

  if (
    !responseBody ||
    responseBody.success === false ||
    (typeof responseBody.code === "number" && responseBody.code !== 0)
  ) {
    failed(
      metadata,
      chainId,
      sellToken,
      buyToken,
      responseBody?.msg || responseText || "Binance Wallet request failed",
    )
  }

  if (responseBody.data === undefined || responseBody.data === null) {
    failed(metadata, chainId, sellToken, buyToken, "Missing response data")
  }

  return responseBody.data
}

function getSignedHeaders({
  pathWithQuery,
  method,
  body,
  config,
}: {
  pathWithQuery: string
  method: "GET"
  body: string
  config: BinanceWalletConfig
}) {
  const timestamp = new Date().toISOString()
  const signature = crypto
    .createHmac("sha256", config.secretKey)
    .update(timestamp + method + pathWithQuery + body, "utf8")
    .digest("base64")

  return {
    accept: "application/json",
    "X-OC-APIKEY": config.apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": signature,
  }
}

function buildPathWithQuery(
  path: string,
  queryParams: Record<string, unknown>,
) {
  const queryString = qs.stringify(queryParams, {
    skipNulls: true,
    arrayFormat: "comma",
  })

  return queryString ? `${path}?${queryString}` : path
}

function isSwapRoute(route: BinanceWalletQuoteRoute) {
  return !route.executionMode || route.executionMode === "SWAP"
}

function compareQuoteRoutes(
  left: BinanceWalletQuoteRoute,
  right: BinanceWalletQuoteRoute,
) {
  if (left.isBest !== right.isBest) return left.isBest ? -1 : 1

  return compareAmountStrings(right.toTokenAmount, left.toTokenAmount)
}

function compareAmountStrings(
  left: string | undefined,
  right: string | undefined,
) {
  const leftAmount = toOptionalBigInt(left)
  const rightAmount = toOptionalBigInt(right)

  if (leftAmount === rightAmount) return 0
  return leftAmount > rightAmount ? 1 : -1
}

function toOptionalBigInt(value: string | undefined) {
  return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n
}

function getAllowanceTarget({
  sellToken,
  approveTarget,
  metadata,
  request,
}: {
  sellToken: TokenAddress
  approveTarget: string | null | undefined
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
  request: QuoteParams<BinanceWalletSupport, BinanceWalletConfig>["request"]
}) {
  if (!approveTarget) {
    return calculateAllowanceTarget(sellToken, Addresses.ZERO_ADDRESS)
  }

  if (!isAddress(approveTarget)) {
    failed(
      metadata,
      request.chainId,
      request.sellToken,
      request.buyToken,
      `Invalid approveTarget ${approveTarget}`,
    )
  }

  return calculateAllowanceTarget(sellToken, getAddress(approveTarget))
}

function requireString({
  value,
  field,
  metadata,
  request,
  chainId,
  sellToken,
  buyToken,
}: {
  value: unknown
  field: string
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
  request?: QuoteParams<BinanceWalletSupport, BinanceWalletConfig>["request"]
  chainId?: ChainId
  sellToken?: TokenAddress
  buyToken?: TokenAddress
}) {
  if (typeof value === "string" && value.length > 0) return value

  failed(
    metadata,
    request?.chainId ?? chainId ?? 0,
    request?.sellToken ?? sellToken ?? Addresses.NATIVE_TOKEN,
    request?.buyToken ?? buyToken ?? Addresses.NATIVE_TOKEN,
    `Missing Binance Wallet ${field}`,
  )
}

function requireIntegerString({
  value,
  field,
  metadata,
  request,
}: {
  value: unknown
  field: string
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
  request: QuoteParams<BinanceWalletSupport, BinanceWalletConfig>["request"]
}) {
  if (typeof value === "string" && /^\d+$/.test(value)) return value

  failed(
    metadata,
    request.chainId,
    request.sellToken,
    request.buyToken,
    `Invalid Binance Wallet ${field}`,
  )
}

function requireAddress({
  value,
  field,
  metadata,
  chainId,
  sellToken,
  buyToken,
}: {
  value: unknown
  field: string
  metadata: QuoteSourceMetadata<BinanceWalletSupport>
  chainId: ChainId
  sellToken: TokenAddress
  buyToken: TokenAddress
}) {
  if (typeof value === "string" && isAddress(value)) {
    return getAddress(value)
  }

  failed(
    metadata,
    chainId,
    sellToken,
    buyToken,
    `Invalid Binance Wallet ${field}`,
  )
}
