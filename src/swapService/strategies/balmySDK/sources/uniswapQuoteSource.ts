import { Chains, getChainByKey } from "@balmy/sdk"
import type { ChainId, TokenAddress } from "@balmy/sdk"
import { Addresses } from "@balmy/sdk"
import { isSameAddress, subtractPercentage, timeToSeconds } from "@balmy/sdk"
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
import { encodeFunctionData, parseAbi } from "viem"

const ROUTER_ADDRESS: Record<ChainId, string> = {
  [Chains.ETHEREUM.chainId]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.OPTIMISM.chainId]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.POLYGON.chainId]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.ARBITRUM.chainId]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.CELO.chainId]: "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
  [Chains.ETHEREUM_GOERLI.chainId]:
    "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.POLYGON_MUMBAI.chainId]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  [Chains.BNB_CHAIN.chainId]: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
  [Chains.BASE.chainId]: "0x2626664c2603336E57B271c5C0b26F421741e481",
  [Chains.AVALANCHE.chainId]: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE",
  [130]: "0x73855d06de49d0fe4a9c42636ba96c62da12ff9c",
}

const UNISWAP_METADATA: QuoteSourceMetadata<UniswapSupport> = {
  name: "Uniswap",
  supports: {
    chains: Object.keys(ROUTER_ADDRESS).map(Number),
    swapAndTransfer: true,
    buyOrders: true,
  },
  logoURI: "ipfs://QmNa3YBYAYS5qSCLuXataV5XCbtxP9ZB4rHUfomRxrpRhJ",
}
type UniswapSupport = { buyOrders: true; swapAndTransfer: true }
type UniswapConfig = object
type UniswapData = { tx: SourceQuoteTransaction }
export class CustomUniswapQuoteSource extends AlwaysValidConfigAndContextSource<
  UniswapSupport,
  UniswapConfig,
  UniswapData
> {
  getMetadata() {
    return UNISWAP_METADATA
  }

  async quote({
    components: { fetchService },
    request: {
      chainId,
      sellToken,
      buyToken,
      order,
      config: { slippagePercentage, timeout, txValidFor },
      accounts: { takeFrom, recipient },
    },
  }: QuoteParams<UniswapSupport>): Promise<SourceQuoteResponse<UniswapData>> {
    const amount = order.type === "sell" ? order.sellAmount : order.buyAmount
    const isSellTokenNativeToken = isSameAddress(
      sellToken,
      Addresses.NATIVE_TOKEN,
    )
    const isBuyTokenNativeToken = isSameAddress(
      buyToken,
      Addresses.NATIVE_TOKEN,
    )
    if (isSellTokenNativeToken && order.type === "buy") {
      // We do this because it's very hard and expensive to wrap native to wToken, spend only
      // some of it and then return the extra native token to the caller
      throw new Error("Uniswap does not support buy orders with native token")
    }
    const router = ROUTER_ADDRESS[chainId]
    recipient = recipient ?? takeFrom

    const queryParams = {
      protocols: "v2,v3,mixed",
      tokenInAddress: mapToWTokenIfNecessary(chainId, sellToken),
      tokenInChainId: chainId,
      tokenOutAddress: mapToWTokenIfNecessary(chainId, buyToken),
      tokenOutChainId: chainId,
      amount: amount.toString(),
      type: order.type === "sell" ? "exactIn" : "exactOut",
      recipient: isBuyTokenNativeToken ? router : recipient,
      deadline: timeToSeconds(txValidFor ?? "3h"),
      slippageTolerance: slippagePercentage,
    }

    const queryString = qs.stringify(queryParams, {
      skipNulls: true,
      arrayFormat: "comma",
    })

    // These are needed so that the API allows us to make the call
    const headers = {
      origin: "https://app.uniswap.org",
      referer: "https://app.uniswap.org/",
    }
    const url = `https://api.uniswap.org/v1/quote?${queryString}`
    const response = await fetchService.fetch(url, { headers, timeout })
    if (!response.ok) {
      failed(
        UNISWAP_METADATA,
        chainId,
        sellToken,
        buyToken,
        await response.text(),
      )
    }
    let {
      quote: quoteAmount,
      methodParameters: { calldata },
    } = await response.json()

    const sellAmount =
      order.type === "sell" ? order.sellAmount : BigInt(quoteAmount)
    const buyAmount =
      order.type === "sell" ? BigInt(quoteAmount) : order.buyAmount
    const value = isSellTokenNativeToken ? sellAmount : undefined

    if (isBuyTokenNativeToken) {
      // Use multicall to unwrap wToken
      const minBuyAmount = calculateMinBuyAmount(
        order.type,
        buyAmount,
        slippagePercentage,
      )
      const unwrapData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "unwrapWETH9",
        args: [minBuyAmount, recipient],
      })
      const multicallData = encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "multicall",
        args: [[calldata, unwrapData]],
      })

      // Update calldata and gas estimate
      calldata = multicallData!
    }

    const quote = {
      sellAmount,
      buyAmount,
      allowanceTarget: calculateAllowanceTarget(sellToken, router),
      customData: {
        tx: {
          to: router,
          calldata,
          value,
        },
      },
    }

    return addQuoteSlippage(quote, order.type, slippagePercentage)
  }

  async buildTx({
    request,
  }: BuildTxParams<
    UniswapConfig,
    UniswapData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

function calculateMinBuyAmount(
  type: "sell" | "buy",
  buyAmount: bigint,
  slippagePercentage: number,
) {
  return type === "sell"
    ? BigInt(subtractPercentage(buyAmount, slippagePercentage, "up"))
    : buyAmount
}

function mapToWTokenIfNecessary(chainId: ChainId, address: TokenAddress) {
  const chain = getChainByKey(chainId)
  return chain && isSameAddress(address, Addresses.NATIVE_TOKEN)
    ? chain.wToken
    : address
}

const ROUTER_HUMAN_READABLE_ABI = [
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] memory results)",
]

const ROUTER_ABI = parseAbi(ROUTER_HUMAN_READABLE_ABI)
