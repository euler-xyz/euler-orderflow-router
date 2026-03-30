import contractBook from "@/common/utils/contractBook"
import { RPC_URLS } from "@/common/utils/viemClients"
import { Chains } from "@balmy/sdk"
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
import {
  createMultiliquidClient,
  mainnet as multiliquidMainnet,
} from "@uniformlabs/multiliquid-evm-sdk"
import {
  http,
  type Address,
  type Hex,
  createPublicClient,
  getAddress,
} from "viem"
import { mainnet as viemMainnet } from "viem/chains"

const MULTILIQUID_METADATA: QuoteSourceMetadata<MultiliquidSupport> = {
  name: "Multiliquid",
  supports: {
    chains: [Chains.ETHEREUM.chainId],
    swapAndTransfer: false,
    buyOrders: true,
  },
  logoURI: "",
}

type MultiliquidSupport = { buyOrders: true; swapAndTransfer: false }
type MultiliquidConfig = object
type MultiliquidData = { tx: SourceQuoteTransaction }
type AssetKind = "rwa" | "stablecoin"
type AssetInfo = { assetId: Hex; kind: AssetKind }

const publicClient = createPublicClient({
  chain: viemMainnet,
  transport: http(RPC_URLS[viemMainnet.id], { timeout: 120_000 }),
}) as any

const multiliquid = createMultiliquidClient({
  deployment: multiliquidMainnet,
  publicClient,
})

const ASSET_BY_TOKEN = new Map<string, AssetInfo>()

for (const [assetId, tokenAddress] of Object.entries(
  multiliquidMainnet.addresses.tokens,
)) {
  const stablecoin = Object.values(multiliquidMainnet.assetIds.stablecoin).some(
    (id) => id === assetId,
  )

  ASSET_BY_TOKEN.set(tokenAddress.toLowerCase(), {
    assetId: assetId as Hex,
    kind: stablecoin ? "stablecoin" : "rwa",
  })
}

const DEFAULT_INTERMEDIATE_STABLECOIN_ID =
  multiliquidMainnet.assetIds.stablecoin.USDC

export class CustomMultiliquidQuoteSource extends AlwaysValidConfigAndContextSource<
  MultiliquidSupport,
  MultiliquidConfig,
  MultiliquidData
> {
  getMetadata() {
    return MULTILIQUID_METADATA
  }

  async quote({
    request: { chainId, sellToken, buyToken, order },
  }: QuoteParams<MultiliquidSupport>): Promise<
    SourceQuoteResponse<MultiliquidData>
  > {
    if (chainId !== multiliquidMainnet.chainId) {
      failed(
        MULTILIQUID_METADATA,
        chainId,
        sellToken,
        buyToken,
        "Multiliquid is only supported on Ethereum mainnet",
      )
    }

    const sellAsset = getAssetInfo(sellToken as Address)
    const buyAsset = getAssetInfo(buyToken as Address)

    if (!sellAsset || !buyAsset) {
      failed(
        MULTILIQUID_METADATA,
        chainId,
        sellToken,
        buyToken,
        "Unsupported Multiliquid asset pair",
      )
    }

    const swapper = getSwapperAddress(chainId)
    const quoted = await quoteAndBuildTx({
      buyAsset,
      order,
      sellAsset,
      swapper,
    })

    return {
      sellAmount: quoted.sellAmount,
      maxSellAmount: quoted.sellAmount,
      buyAmount: quoted.buyAmount,
      minBuyAmount: quoted.buyAmount,
      allowanceTarget: calculateAllowanceTarget(
        sellToken,
        multiliquidMainnet.addresses.multiliquidSwap,
      ),
      estimatedGas: quoted.estimatedGas,
      customData: {
        tx: quoted.tx,
      },
      type: order.type,
    }
  }

  async buildTx({
    request,
  }: BuildTxParams<
    MultiliquidConfig,
    MultiliquidData
  >): Promise<SourceQuoteTransaction> {
    return request.customData.tx
  }
}

function getAssetInfo(token: Address): AssetInfo | undefined {
  return ASSET_BY_TOKEN.get(token.toLowerCase())
}

function getSwapperAddress(chainId: number): Address {
  const swapper = contractBook.swapper.address[chainId]
  if (!swapper) throw new Error(`Missing swapper address for chain ${chainId}`)
  return getAddress(swapper)
}

async function quoteAndBuildTx({
  sellAsset,
  buyAsset,
  order,
  swapper,
}: {
  sellAsset: AssetInfo
  buyAsset: AssetInfo
  order: QuoteParams<MultiliquidSupport>["request"]["order"]
  swapper: Address
}) {
  if (sellAsset.kind === "stablecoin" && buyAsset.kind === "rwa") {
    if (order.type === "sell") {
      const quote = await multiliquid.quote.swapIntoRWA({
        rwaID: buyAsset.assetId,
        stablecoinID: sellAsset.assetId,
        stablecoinAmount: order.sellAmount,
        user: swapper,
        simulate: true,
      })

      return {
        sellAmount: quote.stablecoinAmount,
        buyAmount: quote.rwaAmount,
        estimatedGas: quote.simulation?.gasEstimate,
        tx: buildTx(
          multiliquid.swap.buildSwapCalldata("swapIntoRWA", {
            rwaID: buyAsset.assetId,
            stablecoinID: sellAsset.assetId,
            stablecoinAmount: quote.stablecoinAmount,
            minRwaAmount: quote.rwaAmount,
          }),
        ),
      }
    }

    const quote = await multiliquid.quote.swapIntoRWAExactOut({
      rwaID: buyAsset.assetId,
      stablecoinID: sellAsset.assetId,
      rwaAmount: order.buyAmount,
      user: swapper,
      simulate: true,
    })

    return {
      sellAmount: quote.stablecoinAmount,
      buyAmount: quote.rwaAmount,
      estimatedGas: quote.simulation?.gasEstimate,
      tx: buildTx(
        multiliquid.swap.buildSwapCalldata("swapIntoRWAExactOut", {
          rwaID: buyAsset.assetId,
          stablecoinID: sellAsset.assetId,
          rwaAmount: quote.rwaAmount,
          maxStablecoinAmount: quote.stablecoinAmount,
        }),
      ),
    }
  }

  if (sellAsset.kind === "rwa" && buyAsset.kind === "stablecoin") {
    if (order.type === "sell") {
      const quote = await multiliquid.quote.swapIntoStablecoin({
        stablecoinID: buyAsset.assetId,
        rwaID: sellAsset.assetId,
        rwaAmount: order.sellAmount,
        user: swapper,
        simulate: true,
      })

      return {
        sellAmount: quote.rwaAmount,
        buyAmount: quote.stablecoinAmount,
        estimatedGas: quote.simulation?.gasEstimate,
        tx: buildTx(
          multiliquid.swap.buildSwapCalldata("swapIntoStablecoin", {
            stablecoinID: buyAsset.assetId,
            rwaID: sellAsset.assetId,
            rwaAmount: quote.rwaAmount,
            minStablecoinAmount: quote.stablecoinAmount,
          }),
        ),
      }
    }

    const quote = await multiliquid.quote.swapIntoStablecoinExactOut({
      stablecoinID: buyAsset.assetId,
      rwaID: sellAsset.assetId,
      stablecoinAmount: order.buyAmount,
      user: swapper,
      simulate: true,
    })

    return {
      sellAmount: quote.rwaAmount,
      buyAmount: quote.stablecoinAmount,
      estimatedGas: quote.simulation?.gasEstimate,
      tx: buildTx(
        multiliquid.swap.buildSwapCalldata("swapIntoStablecoinExactOut", {
          stablecoinID: buyAsset.assetId,
          rwaID: sellAsset.assetId,
          stablecoinAmount: quote.stablecoinAmount,
          maxRwaAmount: quote.rwaAmount,
        }),
      ),
    }
  }

  if (sellAsset.kind === "rwa" && buyAsset.kind === "rwa") {
    const quote = await multiliquid.quote.swapRWAToRWA({
      stablecoinID: DEFAULT_INTERMEDIATE_STABLECOIN_ID,
      rwaInID: sellAsset.assetId,
      rwaOutID: buyAsset.assetId,
      exactOut: order.type === "buy",
      rwaInAmount: order.type === "sell" ? order.sellAmount : 0n,
      rwaOutAmount: order.type === "buy" ? order.buyAmount : 0n,
      user: swapper,
      simulate: true,
    })

    return {
      sellAmount: quote.rwaInAmount,
      buyAmount: quote.rwaOutAmount,
      estimatedGas: quote.simulation?.gasEstimate,
      tx: buildTx(
        multiliquid.swap.buildSwapCalldata("swapRWAToRWA", {
          stablecoinID: DEFAULT_INTERMEDIATE_STABLECOIN_ID,
          rwaInID: sellAsset.assetId,
          rwaOutID: buyAsset.assetId,
          exactOut: order.type === "buy",
          rwaInAmount: quote.rwaInAmount,
          rwaOutAmount: quote.rwaOutAmount,
        }),
      ),
    }
  }

  if (sellAsset.kind === "stablecoin" && buyAsset.kind === "stablecoin") {
    const quote = await multiliquid.quote.swapStablecoinToStablecoin({
      stablecoinInID: sellAsset.assetId,
      stablecoinOutID: buyAsset.assetId,
      exactOut: order.type === "buy",
      useDelegateForStablecoinOut: true,
      stablecoinInAmount: order.type === "sell" ? order.sellAmount : 0n,
      stablecoinOutAmount: order.type === "buy" ? order.buyAmount : 0n,
      user: swapper,
      simulate: true,
    })

    return {
      sellAmount: quote.stablecoinInAmount,
      buyAmount: quote.stablecoinOutAmount,
      estimatedGas: quote.simulation?.gasEstimate,
      tx: buildTx(
        multiliquid.swap.buildSwapCalldata("swapStablecoinToStablecoin", {
          exactOut: order.type === "buy",
          useDelegateForStablecoinOut: true,
          stablecoinInID: sellAsset.assetId,
          stablecoinInAmount: quote.stablecoinInAmount,
          stablecoinOutID: buyAsset.assetId,
          stablecoinOutAmount: quote.stablecoinOutAmount,
        }),
      ),
    }
  }

  throw new Error("Unsupported Multiliquid asset pair")
}

function buildTx(calldata: Hex): SourceQuoteTransaction {
  return {
    to: multiliquidMainnet.addresses.multiliquidSwap,
    calldata,
    value: 0n,
  }
}
