import {
  type Address,
  Addresses,
  Chains,
  isSameAddress,
  timeoutPromise,
} from "@balmy/sdk"
import { AlwaysValidConfigAndContextSource } from "@balmy/sdk/dist/services/quotes/quote-sources/base/always-valid-source"
import type {
  BuildTxParams,
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  addQuoteSlippage,
  calculateAllowanceTarget,
  checksum,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"

// Supported Networks: https://docs.odos.xyz/#future-oriented-and-scalable
const ODOS_METADATA: QuoteSourceMetadata<OdosSupport> = {
  name: "Odos",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.POLYGON.chainId,
      Chains.ARBITRUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.AVALANCHE.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.FANTOM.chainId,
      Chains.BASE_GOERLI.chainId,
      Chains.BASE.chainId,
      Chains.MODE.chainId,
      Chains.LINEA.chainId,
      Chains.MANTLE.chainId,
      Chains.SCROLL.chainId,
      Chains.SONIC.chainId,
      239, // tac
      59144, // linea
    ],
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://Qma71evDJfVUSBU53qkf8eDDysUgojsZNSnFRWa4qWragz",
}

type SourcesConfig =
  | { sourceAllowlist?: string[]; sourceDenylist?: undefined }
  | { sourceAllowlist?: undefined; sourceDenylist?: string[] }
type OdosSupport = { buyOrders: false; swapAndTransfer: true }
type OdosConfig = {
  supportRFQs?: boolean
  referralCode: number
  apiKey: string
} & SourcesConfig
type OdosData = { tx: SourceQuoteTransaction }
export class CustomOdosQuoteSource extends AlwaysValidConfigAndContextSource<
  OdosSupport,
  OdosConfig,
  OdosData
> {
  getMetadata() {
    return ODOS_METADATA
  }

  async quote(
    params: QuoteParams<OdosSupport, OdosConfig>,
  ): Promise<SourceQuoteResponse<OdosData>> {
    // Note: Odos supports simple and advanced quotes. Simple quotes may offer worse prices, but it resolves faster. Since the advanced quote
    //       might timeout, we will make two quotes (one simple and one advanced) and we'll return the simple one if the other one timeouts
    const simpleQuote = getQuote({ ...params, simple: true })
    const advancedQuote = timeoutPromise(
      getQuote({ ...params, simple: false }),
      params.request.config.timeout,
      { reduceBy: "100ms" },
    )
    const [simple, advanced] = await Promise.allSettled([
      simpleQuote,
      advancedQuote,
    ])

    if (advanced.status === "fulfilled") {
      return advanced.value
    }
    if (simple.status === "fulfilled") {
      return simple.value
    }

    return Promise.reject(simple.reason)
  }

  async buildTx({
    request,
  }: BuildTxParams<OdosConfig, OdosData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

async function getQuote({
  simple,
  components: { fetchService },
  request: {
    chainId,
    sellToken,
    buyToken,
    order,
    accounts: { takeFrom, recipient },
    config: { slippagePercentage, timeout },
  },
  config,
}: QuoteParams<OdosSupport, OdosConfig> & { simple: boolean }): Promise<
  SourceQuoteResponse<OdosData>
> {
  const checksummedSell = checksumAndMapIfNecessary(sellToken)
  const checksummedBuy = checksumAndMapIfNecessary(buyToken)
  const userAddr = checksum(takeFrom)
  const quoteBody = {
    chainId,
    inputTokens: [
      { tokenAddress: checksummedSell, amount: order.sellAmount.toString() },
    ],
    outputTokens: [{ tokenAddress: checksummedBuy, proportion: 1 }],
    userAddr,
    slippageLimitPercent: slippagePercentage,
    sourceWhitelist: config?.sourceAllowlist,
    sourceBlacklist: config?.sourceDenylist,
    simulate: !config.disableValidation,
    pathViz: false,
    disableRFQs: !config?.supportRFQs, // Disable by default
    simple,
    referralCode: config.referralCode,
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
  }

  const [quoteResponse, routerResponse] = await Promise.all([
    fetchService.fetch("https://enterprise-api.odos.xyz/sor/quote/v2", {
      body: JSON.stringify(quoteBody),
      method: "POST",
      headers,
      timeout,
    }),
    fetchService.fetch(
      `https://enterprise-api.odos.xyz/info/router/v2/${chainId}`,
      {
        headers,
        timeout,
      },
    ),
  ])

  if (!quoteResponse.ok) {
    failed(
      ODOS_METADATA,
      chainId,
      sellToken,
      buyToken,
      await quoteResponse.text(),
    )
  }
  if (!routerResponse.ok) {
    failed(
      ODOS_METADATA,
      chainId,
      sellToken,
      buyToken,
      await routerResponse.text(),
    )
  }
  const {
    pathId,
    gasEstimate,
    outAmounts: [outputTokenAmount],
  }: QuoteResponse = await quoteResponse.json()

  const { address } = await routerResponse.json()

  const assembleResponse = await fetchService.fetch(
    "https://enterprise-api.odos.xyz/sor/assemble",
    {
      body: JSON.stringify({ userAddr, pathId, receiver: recipient }),
      method: "POST",
      headers,
      timeout,
    },
  )
  if (!assembleResponse.ok) {
    failed(
      ODOS_METADATA,
      chainId,
      sellToken,
      buyToken,
      await assembleResponse.text(),
    )
  }
  const {
    transaction: { data, to, value },
  }: AssemblyResponse = await assembleResponse.json()

  const quote = {
    sellAmount: order.sellAmount,
    buyAmount: BigInt(outputTokenAmount),
    estimatedGas: BigInt(gasEstimate),
    allowanceTarget: calculateAllowanceTarget(sellToken, address),
    customData: {
      tx: {
        to,
        calldata: data,
        value: BigInt(value),
      },
      pathId,
      userAddr,
      recipient: recipient ? checksum(recipient) : userAddr,
    },
  }

  return addQuoteSlippage(quote, "sell", slippagePercentage)
}

function checksumAndMapIfNecessary(address: Address) {
  return isSameAddress(address, Addresses.NATIVE_TOKEN)
    ? Addresses.ZERO_ADDRESS
    : checksum(address)
}

type QuoteResponse = {
  gasEstimate: number
  pathId: string
  outAmounts: string[]
}

type AssemblyResponse = {
  transaction: {
    to: Address
    data: string
    value: number
  }
}
