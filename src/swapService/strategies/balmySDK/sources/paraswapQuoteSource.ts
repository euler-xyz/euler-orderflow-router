import { Chains, calculateDeadline } from "@balmy/sdk"
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

const PARASWAP_METADATA: QuoteSourceMetadata<ParaswapSupport> = {
  name: "Velora",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.POLYGON.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.AVALANCHE.chainId,
      Chains.FANTOM.chainId,
      Chains.ARBITRUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.POLYGON_ZKEVM.chainId,
      Chains.BASE.chainId,
      Chains.GNOSIS.chainId,
      130, // unichain
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: "ipfs://QmVtj4RwZ5MMfKpbfv8qXksb5WYBJsQXkaZXLq7ipvMNW5",
}
type ParaswapSupport = { buyOrders: true; swapAndTransfer: true }
type ParaswapConfig = { sourceAllowlist?: string[]; sourceDenylist?: string[] }
type ParaswapData = { tx: SourceQuoteTransaction }
export class CustomParaswapQuoteSource extends AlwaysValidConfigAndContextSource<
  ParaswapSupport,
  ParaswapConfig,
  ParaswapData
> {
  getMetadata(): QuoteSourceMetadata<ParaswapSupport> {
    return PARASWAP_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { timeout, slippagePercentage, txValidFor },
      external,
    },
    config,
  }: QuoteParams<ParaswapSupport, ParaswapConfig>): Promise<
    SourceQuoteResponse<ParaswapData>
  > {
    const {
      sellToken: { decimals: srcDecimals },
      buyToken: { decimals: destDecimals },
    } = await external.tokenData.request()
    const queryParams = {
      network: chainId,
      srcToken: sellToken,
      destToken: buyToken,
      amount: order.type === "sell" ? order.sellAmount : order.buyAmount,
      side: order.type.toUpperCase(),
      srcDecimals,
      destDecimals,
      includeDEXS: config.sourceAllowlist,
      excludeDEXS: config.sourceDenylist,
      slippage: slippagePercentage * 100,
      userAddress: takeFrom,
      receiver: takeFrom !== recipient ? recipient : undefined,
      partner: config.referrer?.name,
      partnerAddress: config.referrer?.address,
      partnerFeeBps: 0,
      deadline: calculateDeadline(txValidFor),
      version: "6.2",
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://api.paraswap.io/swap?${queryString}`
    const response = await fetchService.fetch(url, { timeout })
    if (!response.ok) {
      failed(
        PARASWAP_METADATA,
        chainId,
        sellToken,
        buyToken,
        await response.text(),
      )
    }
    const {
      priceRoute,
      txParams: { to, data, value },
    } = await response.json()
    const quote = {
      sellAmount: BigInt(priceRoute.srcAmount),
      buyAmount: BigInt(priceRoute.destAmount),
      // estimatedGas: BigInt(priceRoute.gasCost),
      allowanceTarget: calculateAllowanceTarget(
        sellToken,
        priceRoute.tokenTransferProxy,
      ),
      customData: {
        tx: {
          to,
          calldata: data,
          value: BigInt(value ?? 0),
        },
      },
    }

    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx({
    request,
  }: BuildTxParams<
    ParaswapConfig,
    ParaswapData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}
