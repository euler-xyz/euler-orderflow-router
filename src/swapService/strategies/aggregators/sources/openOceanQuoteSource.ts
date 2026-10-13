import { logWarn } from "@/common/utils/logs"
import { viemClients } from "@/common/utils/viemClients"
import { aggregatorChainSettings } from "@/swapService/config/chains"
import { Addresses, isSameAddress } from "@balmy/sdk"
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

// https://docs.openocean.finance/dev/supported-chains
const SUPPORTED_CHAINS = aggregatorChainSettings("open-ocean")

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
    const { sellToken: sellTokenDataResult } =
      await external.tokenData.request()
    const client = getViemClient(chainId)
    const gasPrice = await client.getGasPrice().catch((error) => {
      logWarn({ name: "Error getting gas price", error })
      return 1n
    })
    const gasPriceGwei = Number.parseFloat(formatUnits(gasPrice, 9))
    const amount = formatUnits(order.sellAmount, sellTokenDataResult.decimals)
    const settings = SUPPORTED_CHAINS[chainId]
    const native =
      settings === true ? Addresses.NATIVE_TOKEN : settings.nativeAsset
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
      referrer:
        chainId === 239
          ? process.env.OPENOCEAN_TAC_REFERRER
          : config.referrer?.address,
      enabledDexIds: config.sourceAllowlist,
      disableRfq: true,
    }
    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })
    const url = `https://open-api-pro.openocean.finance/v3/${chainId}/swap_quote?${queryString}`
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
        rfqDeadline,
        estimatedGas,
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
  }: BuildTxParams<
    OpenOceanConfig,
    OpenOceanData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

const getViemClient = (chainId: number) => {
  if (!viemClients[chainId])
    throw new Error(`No client found for chainId ${chainId}`)
  return viemClients[chainId].extend(publicActions)
}
