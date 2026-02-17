import { Chains } from "@balmy/sdk"
import { Addresses } from "@balmy/sdk"
import { isSameAddress } from "@balmy/sdk"
import type { TokenAddress } from "@balmy/sdk"
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

// Supported networks: https://li.quest/v1/chains
const LI_FI_METADATA: QuoteSourceMetadata<LiFiSupport> = {
  name: "LI.FI",
  supports: {
    chains: [
      Chains.ETHEREUM.chainId,
      Chains.POLYGON.chainId,
      Chains.BNB_CHAIN.chainId,
      Chains.GNOSIS.chainId,
      Chains.FANTOM.chainId,
      Chains.OKC.chainId,
      Chains.AVALANCHE.chainId,
      Chains.ARBITRUM.chainId,
      Chains.OPTIMISM.chainId,
      Chains.MOONRIVER.chainId,
      Chains.MOONBEAM.chainId,
      Chains.CELO.chainId,
      Chains.FUSE.chainId,
      Chains.CRONOS.chainId,
      Chains.VELAS.chainId,
      Chains.AURORA.chainId,
      Chains.EVMOS.chainId,
      Chains.POLYGON_ZKEVM.chainId,
      Chains.BASE.chainId,
      Chains.ROOTSTOCK.chainId,
      Chains.MODE.chainId,
      Chains.LINEA.chainId,
      Chains.BOBA.chainId,
      Chains.METIS_ANDROMEDA.chainId,
      Chains.SCROLL.chainId,
      Chains.BLAST.chainId,
      Chains.MANTLE.chainId,
      80094, // berachain
      130, // unichain
    ],
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: "ipfs://QmUgcnaNxsgQdjBjytxvXfeSfsDryh9bF4mNaz1Bp5QwJ4",
}
type LiFiConfig = { apiKey?: string }
type LiFiSupport = { buyOrders: true; swapAndTransfer: true }
type LiFiData = { tx: SourceQuoteTransaction }
export class CustomLiFiQuoteSource extends AlwaysValidConfigAndContextSource<
  LiFiSupport,
  LiFiConfig
> {
  getMetadata() {
    return LI_FI_METADATA
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
  }: QuoteParams<LiFiSupport, LiFiConfig>): Promise<
    SourceQuoteResponse<LiFiData>
  > {
    const mappedSellToken = mapNativeToken(sellToken)
    const mappedBuyToken = mapNativeToken(buyToken)

    const params = new URLSearchParams({
      fromChain: chainId.toString(),
      toChain: chainId.toString(),
      fromToken: mappedSellToken,
      toToken: mappedBuyToken,
      fromAddress: takeFrom,
      toAddress: recipient ?? takeFrom,
      slippage: String(slippagePercentage / 100), // 1 = 100%
      denyExchanges: "kyberswap,1inch",
      ...(config.referrer
        ? {
            integrator: config.referrer.name,
            referrer: config.referrer.address,
          }
        : {}),
      ...(order.type === "sell"
        ? { fromAmount: order.sellAmount.toString() }
        : { toAmount: order.buyAmount.toString() }),
    })

    const url =
      order.type === "sell"
        ? `https://li.quest/v1/quote?${params.toString()}`
        : `https://li.quest/v1/quote/toAmount?${params.toString()}`

    const headers: Record<string, string> = {}
    if (config.apiKey) {
      headers["x-lifi-api-key"] = config.apiKey
    }

    const response = await fetchService.fetch(url, { timeout, headers })

    if (!response.ok) {
      failed(
        LI_FI_METADATA,
        chainId,
        sellToken,
        buyToken,
        await response.text(),
      )
    }
    const {
      estimate: {
        approvalAddress,
        toAmountMin,
        toAmount,
        fromAmount,
        gasCosts,
      },
      transactionRequest: { to, data, value },
    } = await response.json()

    const estimatedGas = (gasCosts as { estimate: bigint }[]).reduce(
      (accum, { estimate }) => accum + BigInt(estimate),
      0n,
    )

    return {
      sellAmount: fromAmount,
      maxSellAmount: fromAmount,
      buyAmount: BigInt(toAmount),
      minBuyAmount: BigInt(toAmountMin),
      type: order.type,
      estimatedGas,
      allowanceTarget: calculateAllowanceTarget(sellToken, approvalAddress),
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
  }: BuildTxParams<LiFiConfig, LiFiData>): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

function mapNativeToken(address: TokenAddress) {
  return isSameAddress(address, Addresses.NATIVE_TOKEN)
    ? Addresses.ZERO_ADDRESS
    : address
}
