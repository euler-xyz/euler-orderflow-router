import { type ChainId, Chains } from "@balmy/sdk"
import { AlwaysValidConfigAndContextSource } from "@balmy/sdk/dist/services/quotes/quote-sources/base/always-valid-source"
import type {
  QuoteParams,
  QuoteSourceMetadata,
  SourceQuoteResponse,
  SourceQuoteTransaction,
} from "@balmy/sdk/dist/services/quotes/quote-sources/types"
import {
  addQuoteSlippage,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import { isAddress, keccak256, toHex, zeroAddress } from "viem"

const SUPPORTED_CHAINS: Record<ChainId, string> = {
  [Chains.ETHEREUM.chainId]: "mainnet",
  [Chains.BNB_CHAIN.chainId]: "bnb",
  [Chains.BASE.chainId]: "base",
  [Chains.ARBITRUM.chainId]: "arbitrum_one",
  [Chains.POLYGON.chainId]: "polygon",
  [Chains.AVALANCHE.chainId]: "avalanche",
  [Chains.LINEA.chainId]: "avalanche",
  [Chains.GNOSIS.chainId]: "xdai",
  [232]: "lens",
}

const COW_METADATA: QuoteSourceMetadata<CoWSupport> = {
  name: "CoW Protocol",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: "",
}
type CoWSupport = { buyOrders: true; swapAndTransfer: true }
type CoWConfig = object
type CoWData = object
type QuoteSwapParams = {
  origin: string
  receiver: string
}

export class CustomCoWQuoteSource extends AlwaysValidConfigAndContextSource<
  CoWSupport,
  CoWConfig,
  CoWData
> {
  getMetadata() {
    return COW_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,

      order,
      accounts: { takeFrom },
      config: { slippagePercentage, timeout },
      swapParams,
    },
  }: QuoteParams<CoWSupport, CoWConfig>): Promise<
    SourceQuoteResponse<CoWData>
  > {
    const origin = (swapParams as QuoteSwapParams).origin
    const receiver = (swapParams as QuoteSwapParams).receiver
    const appData = `{\"appCode\":\"CoW Protocol\",\"environment\":\"production\",\"metadata\":{\"orderClass\":{\"orderClass\":\"market\"},\"quote\":{\"slippageBips\":${Math.floor(slippagePercentage / 100)},\"smartSlippage\":true}},\"version\":\"1.10.0\"}`
    const appDataHash = keccak256(toHex(appData))
    const queryBody = {
      sellToken,
      buyToken: receiver, // the evault
      receiver: origin,
      appData,
      appDataHash,
      from: takeFrom,
      priceQuality: "optimal",
      signingScheme: "eip712",
      validFor: 1800,
      kind: order.type,
      ...(order.type === "sell"
        ? { sellAmountBeforeFee: order.sellAmount.toString() }
        : { buyAmountAfterFee: order.buyAmount.toString() }),
    }

    const quoteUrl = `https://api.cow.fi/${SUPPORTED_CHAINS[chainId]}/api/v1/quote`
    // const quoteUrl = `http://localhost:8080/api/v1/quote`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const quoteResponse = await fetchService.fetch(quoteUrl, {
      method: "POST",
      timeout,
      headers,
      body: JSON.stringify(queryBody),
    })

    if (!quoteResponse.ok) {
      failed(
        COW_METADATA,
        chainId,
        sellToken,
        receiver,
        await quoteResponse.text(),
      )
    }
    const {
      quote: { sellAmount, buyAmount },
    } = await quoteResponse.json()

    const quote = {
      sellAmount,
      buyAmount,
      allowanceTarget: zeroAddress,
      estimatedGas: 0n,
      customData: {},
    }

    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx(): Promise<SourceQuoteTransaction> {
    return {
      to: zeroAddress,
      calldata: "",
    }
  }
}
