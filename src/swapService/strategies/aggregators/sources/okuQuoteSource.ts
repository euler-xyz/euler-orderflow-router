import {
  type Address,
  Addresses,
  type ChainId,
  type GasPrice,
  type TimeString,
  type TokenAddress,
  getChainByKey,
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
import type { Hex } from "@berachain-foundation/berancer-sdk"
import {
  type Address as ViemAddress,
  encodeFunctionData,
  formatUnits,
  parseAbi,
  parseUnits,
} from "viem"

const CHAINS: Record<ChainId, Record<string, string>> = {
  [60808]: {
    key: "bob",
    permit2Adapter: "0x867c17C297083cD7d73B39C89e4602878C4Caa65",
  },
}

const OKU_METADATA: QuoteSourceMetadata<OkuSupport> = {
  name: "Oku",
  supports: {
    chains: Object.keys(CHAINS).map(Number),
    swapAndTransfer: false,
    buyOrders: true,
  },
  logoURI: "ipfs://QmS2Kf7sZz7DrcwWU9nNG8eGt2126G2p2c9PTDFT774sW7",
}

type OkuSupport = { buyOrders: true; swapAndTransfer: false }
type OkuConfig = object
type OkuData = {
  coupon: any
  signingRequest: any
  txValidFor: TimeString | undefined
  takeFrom: Address
  tx: SourceQuoteTransaction
}

export class CustomOkuQuoteSource extends AlwaysValidConfigAndContextSource<
  OkuSupport,
  OkuConfig,
  OkuData
> {
  private market: string
  private marketName: string
  private chains: number[] | undefined

  constructor(market = "usor", marketName = "Uniswap", chains?: number[]) {
    super()
    this.market = market
    this.marketName = marketName
    this.chains = chains
  }
  getMetadata() {
    return {
      ...OKU_METADATA,
      name: `${OKU_METADATA.name} ${this.marketName}`,
      supports: {
        ...OKU_METADATA.supports,
        chains: this.chains || OKU_METADATA.supports.chains,
      },
    }
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom },
      external,
    },
  }: QuoteParams<OkuSupport>): Promise<SourceQuoteResponse<OkuData>> {
    const chain = getChainByKey(chainId)
    if (
      chain &&
      isSameAddress(chain.wToken, sellToken) &&
      isSameAddress(Addresses.NATIVE_TOKEN, buyToken)
    )
      throw new Error("Native token wrap not supported by this source")
    if (
      chain &&
      isSameAddress(Addresses.NATIVE_TOKEN, sellToken) &&
      isSameAddress(chain.wToken, buyToken)
    )
      throw new Error("Native token wrap not supported by this source")

    const [gasPrice, tokenData] = await Promise.all([
      external.gasPrice.request(),
      external.tokenData.request(),
    ])

    const body = {
      chain: CHAINS[chainId].key,
      account:
        this.market === "usor" ? CHAINS[chainId].permit2Adapter : takeFrom,
      gasPrice: Number(eip1159ToLegacy(gasPrice)),
      isExactIn: order.type === "sell",
      inTokenAddress: mapToken(sellToken),
      outTokenAddress: mapToken(buyToken),
      slippage: slippagePercentage * 100,
      ...(order.type === "sell"
        ? {
            inTokenAmount: formatUnits(
              order.sellAmount,
              tokenData.sellToken.decimals,
            ),
          }
        : {
            outTokenAmount: formatUnits(
              order.buyAmount,
              tokenData.buyToken.decimals,
            ),
          }),
    }
    const quoteResponse = await fetchService.fetch(
      `https://canoe.v2.icarus.tools/market/${this.market}/swap_quote`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        timeout,
      },
    )
    if (!quoteResponse.ok) {
      failed(
        OKU_METADATA,
        chainId,
        sellToken,
        buyToken,
        await quoteResponse.text(),
      )
    }
    const response = await quoteResponse.json()
    const { coupon, inAmount, outAmount, signingRequest } = response
    const sellAmount = parseUnits(inAmount, tokenData.sellToken.decimals)
    const buyAmount = parseUnits(outAmount, tokenData.buyToken.decimals)
    const to = coupon.raw.executionInformation.trade.to
    const quote = {
      sellAmount,
      buyAmount,
      type: order.type,
      allowanceTarget: calculateAllowanceTarget(sellToken, to),
      customData: {
        coupon,
        signingRequest,
        txValidFor,
        takeFrom,
        tx: {
          to,
          calldata: coupon.raw.executionInformation.trade.data,
          value: coupon.raw.executionInformation.trade.value,
        },
      },
    }
    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx({
    request,
  }: BuildTxParams<OkuConfig, OkuData>): Promise<SourceQuoteTransaction> {
    if (this.market === "usor") {
      const adapterAbi = parseAbi([
        "function swap(address target, address tokenIn, address tokenOut, uint256 amount, address receiver, uint256 sweepMinAmount, bytes calldata data)",
      ])
      const calldata = encodeFunctionData({
        abi: adapterAbi,
        functionName: "swap",
        args: [
          request.customData.tx.to as Hex,
          request.sellToken as Hex,
          request.buyToken as Hex,
          request.maxSellAmount,
          request.accounts.recipient as Hex,
          5n,
          request.customData.tx.calldata as Hex,
        ],
      })
      return {
        to: CHAINS[request.chainId].permit2Adapter,
        calldata,
        value: request.customData.tx.value,
      }
    }

    return request.customData.tx
  }
}

function mapToken(address: TokenAddress) {
  return isSameAddress(address, Addresses.NATIVE_TOKEN)
    ? Addresses.ZERO_ADDRESS
    : (address as ViemAddress)
}

function eip1159ToLegacy(gasPrice: GasPrice): bigint {
  if ("gasPrice" in gasPrice) {
    return BigInt(gasPrice.gasPrice)
  }
  return BigInt(gasPrice.maxFeePerGas)
}
