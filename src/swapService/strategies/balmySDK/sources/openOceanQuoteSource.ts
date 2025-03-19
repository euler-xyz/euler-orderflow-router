import {
  type Address,
  Addresses,
  type ChainId,
  Chains,
  isSameAddress,
} from "@balmy/sdk"
import type { GasPrice } from "@balmy/sdk/dist/services/gas/types"
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
import { formatUnits } from "viem"

// https://docs.openocean.finance/dev/supported-chains
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
  [Chains.MOONRIVER.chainId]: { chainKey: "moonriver" },
  [Chains.AURORA.chainId]: { chainKey: "aurora" },
  [Chains.CRONOS.chainId]: {
    chainKey: "cronos",
    nativeAsset: "0x0000000000000000000000000000000000000000",
  },
  [Chains.HARMONY_SHARD_0.chainId]: { chainKey: "harmony" },
  [Chains.KAVA.chainId]: { chainKey: "kava" },
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
  [Chains.opBNB.chainId]: { chainKey: "opbnb" },
  [Chains.BLAST.chainId]: { chainKey: "blast" },
  [Chains.ROOTSTOCK.chainId]: { chainKey: "rootstock" },
  [Chains.MODE.chainId]: { chainKey: "mode" },
  [146]: { chainKey: "sonic" },
  [80094]: { chainKey: "berachain" },
}

const OPEN_OCEAN_METADATA: QuoteSourceMetadata<OpenOceanSupport> = {
  name: "Open Ocean",
  supports: {
    chains: Object.keys(SUPPORTED_CHAINS).map(Number),
    swapAndTransfer: true,
    buyOrders: false,
  },
  logoURI: "ipfs://QmP7bVENjMmobmjJcPFX6VbFTmj6pKmFNqv7Qkyqui44dT",
}
type OpenOceanSupport = { buyOrders: false; swapAndTransfer: true }
type OpenOceanConfig = { sourceAllowlist?: string[]; apiKey?: string }
type OpenOceanData = { tx: SourceQuoteTransaction }
export class CustomOpenOceanQuoteSource extends AlwaysValidConfigAndContextSource<
  OpenOceanSupport,
  OpenOceanConfig,
  OpenOceanData
> {
  getMetadata() {
    return OPEN_OCEAN_METADATA
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
  }: QuoteParams<OpenOceanSupport, OpenOceanConfig>): Promise<
    SourceQuoteResponse<OpenOceanData>
  > {
    const [{ sellToken: sellTokenDataResult }, gasPriceResult] =
      await Promise.all([
        external.tokenData.request(),
        external.gasPrice.request(),
      ])
    const legacyGasPrice = eip1159ToLegacy(gasPriceResult)
    const gasPrice = Number.parseFloat(formatUnits(legacyGasPrice, 9))
    const amount = formatUnits(order.sellAmount, sellTokenDataResult.decimals)
    const { chainKey, nativeAsset } = SUPPORTED_CHAINS[chainId]
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
      gasPrice: gasPrice,
      account: recipient ?? takeFrom,
      referrer: config.referrer?.address,
      enabledDexIds: config.sourceAllowlist,
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://open-api-pro.openocean.finance/v3/${chainKey}/swap_quote?${queryString}`
    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers["apikey"] = config.apiKey
    }

    const response = await fetchService.fetch(url, { timeout, headers })
    if (!response.ok) {
      failed(
        OPEN_OCEAN_METADATA,
        chainId,
        sellToken,
        buyToken,
        await response.text(),
      )
    }

    const {
      data: {
        outAmount,
        minOutAmount,
        to,
        value,
        data,
        rfqDeadline /* estimatedGas */,
      },
    } = await response.json()

    if (Number(rfqDeadline) > 0) {
      failed(
        OPEN_OCEAN_METADATA,
        chainId,
        sellToken,
        buyToken,
        "RFQ not allowed",
      )
    }

    return {
      sellAmount: order.sellAmount,
      maxSellAmount: order.sellAmount,
      buyAmount: BigInt(outAmount),
      minBuyAmount: BigInt(minOutAmount),
      type: "sell",
      // estimatedGas: BigInt(estimatedGas), // TODO fix unknown chains handling in SDK
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
  }: BuildTxParams<
    OpenOceanConfig,
    OpenOceanData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

function eip1159ToLegacy(gasPrice: GasPrice): bigint {
  if ("gasPrice" in gasPrice) {
    return BigInt(gasPrice.gasPrice)
  }
  return BigInt(gasPrice.maxFeePerGas)
}
