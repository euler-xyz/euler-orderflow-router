import {
  type Address,
  Addresses,
  type ChainId,
  Chains,
  type TimeString,
  calculateDeadline,
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

const SUPPORTED_CHAINS: Record<ChainId, string> = {
  [Chains.ARBITRUM.chainId]: "arbitrum",
  [Chains.AURORA.chainId]: "aurora",
  [Chains.AVALANCHE.chainId]: "avalanche",
  [Chains.BNB_CHAIN.chainId]: "bsc",
  [Chains.BIT_TORRENT.chainId]: "bttc",
  [Chains.CRONOS.chainId]: "cronos",
  [Chains.ETHEREUM.chainId]: "ethereum",
  [Chains.FANTOM.chainId]: "fantom",
  [Chains.OASIS_EMERALD.chainId]: "oasis",
  [Chains.POLYGON.chainId]: "polygon",
  [Chains.VELAS.chainId]: "velas",
  [Chains.OPTIMISM.chainId]: "optimism",
  [Chains.LINEA.chainId]: "linea",
  [Chains.BASE.chainId]: "base",
  [Chains.POLYGON_ZKEVM.chainId]: "polygon-zkevm",
  [Chains.SCROLL.chainId]: "scroll",
  [Chains.BLAST.chainId]: "blast",
  [Chains.MANTLE.chainId]: "mantle",
  [Chains.SONIC.chainId]: "sonic",
  [Chains.ZK_SYNC_ERA.chainId]: "zksync",
  [130]: "unichain",
  [59144]: "linea",
}

const KYBERSWAP_METADATA: QuoteSourceMetadata<KyberswapSupport> = {
  name: "Kyberswap",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://QmNcTVyqeVtNoyrT546VgJTD4vsZEkWp6zhDJ4qhgKkhbK",
}
type KyberswapSupport = { buyOrders: false; swapAndTransfer: true }
type KyberswapConfig = object
type KyberswapData = {
  routeSummary: RouteSummary
  txValidFor: TimeString | undefined
  slippagePercentage: number
  takeFrom: Address
  recipient: Address | undefined
}
export class CustomKyberswapQuoteSource extends AlwaysValidConfigAndContextSource<
  KyberswapSupport,
  KyberswapConfig,
  KyberswapData
> {
  getMetadata() {
    return KYBERSWAP_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      accounts: { takeFrom, recipient },
      config: { slippagePercentage, timeout, txValidFor },
    },
    config,
  }: QuoteParams<KyberswapSupport>): Promise<
    SourceQuoteResponse<KyberswapData>
  > {
    const chainKey = SUPPORTED_CHAINS[chainId]
    const headers = config.referrer?.name
      ? { "x-client-id": config.referrer?.name }
      : undefined

    const url = `https://aggregator-api.kyberswap.com/${chainKey}/api/v1/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${order.sellAmount.toString()}&saveGas=0&gasInclude=true&excludedSources=clipper,hashflow-v3,kyberswap-limit-order,kyberswap-limit-order-v2,mx-trading,native-v1,native-v2`
    const routeResponse = await fetchService.fetch(url, { timeout, headers })

    if (!routeResponse.ok) {
      failed(
        KYBERSWAP_METADATA,
        chainId,
        sellToken,
        buyToken,
        await routeResponse.text(),
      )
    }
    const {
      data: { routeSummary, routerAddress },
    }: { data: { routeSummary: RouteSummary; routerAddress: Address } } =
      await routeResponse.json()

    const quote = {
      sellAmount: order.sellAmount,
      buyAmount: BigInt(routeSummary.amountOut),
      // estimatedGas: BigInt(routeSummary.gas),
      allowanceTarget: calculateAllowanceTarget(sellToken, routerAddress),
      customData: {
        routeSummary,
        slippagePercentage,
        txValidFor,
        takeFrom,
        recipient,
      },
    }

    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      sellAmount,
      config: { timeout },
      customData: {
        routeSummary,
        txValidFor,
        slippagePercentage,
        takeFrom,
        recipient,
      },
    },
    config,
  }: BuildTxParams<
    KyberswapConfig,
    KyberswapData
  >): Promise<SourceQuoteTransaction> {
    const chainKey = SUPPORTED_CHAINS[chainId]
    const headers = config.referrer?.name
      ? { "x-client-id": config.referrer?.name }
      : undefined

    const buildResponse = await fetchService.fetch(
      `https://aggregator-api.kyberswap.com/${chainKey}/api/v1/route/build`,
      {
        timeout,
        headers,
        method: "POST",
        body: JSON.stringify({
          routeSummary,
          slippageTolerance: slippagePercentage * 100,
          recipient: recipient ?? takeFrom,
          deadline: txValidFor ? calculateDeadline(txValidFor) : undefined,
          source: config.referrer?.name,
          sender: takeFrom,
          skipSimulateTransaction: config.disableValidation,
        }),
      },
    )
    if (!buildResponse.ok) {
      failed(
        KYBERSWAP_METADATA,
        chainId,
        sellToken,
        buyToken,
        await buildResponse.text(),
      )
    }
    const {
      data: { data, routerAddress },
    } = await buildResponse.json()

    if (!data) {
      failed(
        KYBERSWAP_METADATA,
        chainId,
        sellToken,
        buyToken,
        "Failed to calculate a quote",
      )
    }

    const value = isSameAddress(sellToken, Addresses.NATIVE_TOKEN)
      ? sellAmount
      : 0n

    return {
      to: routerAddress,
      value,
      calldata: data,
    }
  }
}

type RouteSummary = {
  amountOut: `${bigint}`
  gas: `${bigint}`
  routerAddress: Address
}
