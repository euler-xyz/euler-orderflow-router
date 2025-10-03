import {
  Addresses,
  type ChainId,
  Chains,
  type TokenAddress,
  isSameAddress,
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
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import qs from "qs"

const SUPPORTED_CHAINS: Record<ChainId, string> = {
  [Chains.ARBITRUM.chainId]: "arbitrum",
  [Chains.AVALANCHE.chainId]: "avalanche",
  [Chains.BNB_CHAIN.chainId]: "bsc",
  [Chains.ETHEREUM.chainId]: "ethereum",
  [Chains.POLYGON.chainId]: "polygon",
  [Chains.OPTIMISM.chainId]: "optimism",
  [Chains.BASE.chainId]: "base",
  [Chains.POLYGON_ZKEVM.chainId]: "polygonzk",
  [Chains.BLAST.chainId]: "blast",
  [Chains.SCROLL.chainId]: "scroll",
  [Chains.METIS_ANDROMEDA.chainId]: "metis",
  [Chains.FANTOM.chainId]: "fantom",
  [Chains.SONIC.chainId]: "sonic",
  80094: "berachain",
  130: "unichain",
  9745: "plasma",
}

const MAGPIE_METADATA: QuoteSourceMetadata<MagpieSupport> = {
  name: "Fly",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://QmfR2ybY1gvctAxU5KArQ1UDXFixBY8ehgTBUBvUqY4Q4b",
}
type MagpieSupport = { buyOrders: false; swapAndTransfer: true }
type MagpieConfig = { sourceAllowlist?: string[]; apiKey?: string }
type MagpieData = { quoteId: string }
export class CustomMagpieQuoteSource extends AlwaysValidConfigAndContextSource<
  MagpieSupport,
  MagpieConfig,
  MagpieData
> {
  getMetadata() {
    return MAGPIE_METADATA
  }

  async quote({
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
  }: QuoteParams<MagpieSupport, MagpieConfig>): Promise<
    SourceQuoteResponse<MagpieData>
  > {
    const quoteQueryParams = {
      network: SUPPORTED_CHAINS[chainId],
      fromTokenAddress: mapToken(sellToken),
      toTokenAddress: mapToken(buyToken),
      sellAmount: order.sellAmount.toString(),
      slippage: slippagePercentage / 100,
      liquiditySources: config.sourceAllowlist,
      fromAddress: takeFrom,
      toAddress: recipient ?? takeFrom,
      gasless: false,
    }

    const quoteQueryString = qs.stringify(quoteQueryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const quoteUrl = `https://api.magpiefi.xyz/aggregator/quote?${quoteQueryString}`
    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers["apikey"] = config.apiKey
    }
    const quoteResponse = await fetchService.fetch(quoteUrl, {
      timeout,
      headers,
    })
    if (!quoteResponse.ok) {
      failed(
        MAGPIE_METADATA,
        chainId,
        sellToken,
        buyToken,
        await quoteResponse.text(),
      )
    }
    const {
      id: quoteId,
      amountOut,
      targetAddress,
      // fees,
    } = await quoteResponse.json()
    // const estimatedGasNum: `${number}` | undefined = fees.find(
    //   (fee: { type: string; value: `${number}` }) => fee.type === "gas",
    // )?.value
    // const estimatedGas = estimatedGasNum
    //   ? parseUnits(estimatedGasNum, 9)
    //   : undefined

    const quote = {
      sellAmount: order.sellAmount,
      buyAmount: BigInt(amountOut),
      // estimatedGas,
      allowanceTarget: calculateAllowanceTarget(sellToken, targetAddress),
      customData: { quoteId, takeFrom, recipient },
    }

    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      config: { timeout },
      customData: { quoteId },
    },
  }: BuildTxParams<MagpieConfig, MagpieData>): Promise<SourceQuoteTransaction> {
    const transactionQueryParams = {
      quoteId,
      estimateGas: false,
    }
    const transactionQueryString = qs.stringify(transactionQueryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const transactionUrl = `https://api.magpiefi.xyz/aggregator/transaction?${transactionQueryString}`
    const transactionResponse = await fetchService.fetch(transactionUrl, {
      timeout,
    })
    if (!transactionResponse.ok) {
      failed(
        MAGPIE_METADATA,
        chainId,
        sellToken,
        buyToken,
        await transactionResponse.text(),
      )
    }
    const { to, value, data } = await transactionResponse.json()
    return { to, calldata: data, value: BigInt(value) }
  }
}

function mapToken(address: TokenAddress) {
  return isSameAddress(address, Addresses.NATIVE_TOKEN)
    ? Addresses.ZERO_ADDRESS
    : address
}
