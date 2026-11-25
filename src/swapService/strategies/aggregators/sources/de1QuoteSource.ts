import { logWarn } from "@/common/utils/logs"
import { viemClients } from "@/common/utils/viemClients"
import {
  type Address,
  Addresses,
  type ChainId,
  Chains,
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
  calculateAllowanceTarget,
  failed,
} from "@balmy/sdk/dist/services/quotes/quote-sources/utils"
import qs from "qs"
import { formatUnits, publicActions } from "viem"
import * as chains from "viem/chains"

// https://docs.de1.exchange/docs/overview/supported-chains
const SUPPORTED_CHAINS: Record<
  ChainId,
  { chainKey: string; nativeAsset?: Address }
> = {
  [Chains.ETHEREUM.chainId]: { chainKey: "eth" },
  [Chains.BNB_CHAIN.chainId]: { chainKey: "bsc" },
  [Chains.POLYGON.chainId]: {
    chainKey: "polygon",
    nativeAsset: "0x0000000000000000000000000000000000001010",
  },
  [Chains.BASE.chainId]: { chainKey: "base" },
  [Chains.LINEA.chainId]: { chainKey: "linea" },
  [Chains.FANTOM.chainId]: {
    chainKey: "fantom",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [Chains.AVALANCHE.chainId]: {
    chainKey: "avax",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [Chains.ARBITRUM.chainId]: { chainKey: "arbitrum" },
  [Chains.OPTIMISM.chainId]: { chainKey: "optimism" },
  [Chains.CRONOS.chainId]: {
    chainKey: "cronos",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [Chains.HARMONY_SHARD_0.chainId]: { chainKey: "harmony" },
  [Chains.METIS_ANDROMEDA.chainId]: {
    chainKey: "metis",
    nativeAsset: "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000",
  },
  [Chains.CELO.chainId]: {
    chainKey: "celo",
    nativeAsset: "0x471ece3750da237f93b8e339c536989b8978a438",
  },
  [Chains.POLYGON_ZKEVM.chainId]: { chainKey: "polygon_zkevm" },
  [Chains.ONTOLOGY.chainId]: { chainKey: "ontvm" },
  [Chains.GNOSIS.chainId]: {
    chainKey: "xdai",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [Chains.ROOTSTOCK.chainId]: { chainKey: "rootstock" },
  [chains.sonic.id]: { chainKey: "sonic" },
  [chains.berachain.id]: { chainKey: "berachain" },
  [chains.hyperEvm.id]: {
    chainKey: "hyperevm",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [chains.unichain.id]: { chainKey: "unichain" }, // fix gas price
  [chains.plasma.id]: { chainKey: "plasma" },
  [chains.monad.id]: { chainKey: "monad" },
  [chains.arc.id]: {
    chainKey: "arc",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
}

const DE1_METADATA: QuoteSourceMetadata<De1Support> = {
  name: "DE1",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://QmP7bVENjMmobmjJcPFX6VbFTmj6pKmFNqv7Qkyqui44dT",
}
type De1Support = { buyOrders: false; swapAndTransfer: true }
type De1Config = { sourceAllowlist?: string[]; apiKey?: string }
type De1Data = { tx: SourceQuoteTransaction }
export class CustomDe1QuoteSource extends AlwaysValidConfigAndContextSource<
  De1Support,
  De1Config,
  De1Data
> {
  getMetadata() {
    return DE1_METADATA
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
      external,
    },
    config,
  }: QuoteParams<De1Support, De1Config>): Promise<
    SourceQuoteResponse<De1Data>
  > {
    const { sellToken: sellTokenDataResult } =
      await external.tokenData.request()
    const client = getViemClient(chainId)
    const gasPrice = await client.getGasPrice().catch((error) => {
      logWarn({ name: "Error getting gas price", error })
      return 1n
    })
    const gasPriceGwei = Number.parseFloat(formatUnits(gasPrice, 9))
    const amount = formatUnits(order.sellAmount, sellTokenDataResult.decimals)
    const { nativeAsset } = SUPPORTED_CHAINS[chainId]
    const native = nativeAsset ?? Addresses.NATIVE_TOKEN
    const queryParams = {
      inTokenAddress: isSameAddress(sellToken, Addresses.NATIVE_TOKEN)
        ? native
        : sellToken,
      outTokenAddress: isSameAddress(buyToken, Addresses.NATIVE_TOKEN)
        ? native
        : buyToken,
      amount: amount,
      slippage: slippagePercentage,
      gasPrice: gasPriceGwei,
      account: recipient ?? takeFrom,
      referrer: config.referrer?.address,
      enabledDexIds: config.sourceAllowlist,
      disableRfq: true,
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://open-api-pro.de1.exchange/v3/${chainId}/swap_quote?${queryString}`
    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers["apikey"] = config.apiKey
    }

    const response = await fetchService.fetch(url, { timeout, headers })

    if (!response.ok) {
      failed(DE1_METADATA, chainId, sellToken, buyToken, await response.text())
    }

    const {
      data: {
        outAmount,
        minOutAmount,
        to,
        value,
        data,
        rfqDeadline,
        estimatedGas,
      },
    } = await response.json()

    if (Number(rfqDeadline) > 0) {
      failed(DE1_METADATA, chainId, sellToken, buyToken, "RFQ not allowed")
    }

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount: BigInt(outAmount),
      minBuyAmount: BigInt(minOutAmount),
      type: "sell",
      estimatedGas: BigInt(estimatedGas),
      allowanceTarget: calculateAllowanceTarget(sellToken, to),
      customData: {
        tx: {
          to,
          calldata: data,
          value: BigInt(value ?? 0),
        },
      },
    }
  }

  async buildTx({
    request,
  }: BuildTxParams<De1Config, De1Data>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

const getViemClient = (chainId: number) => {
  if (!viemClients[chainId])
    throw new Error(`No client found for chainId ${chainId}`)
  return viemClients[chainId].extend(publicActions)
}
