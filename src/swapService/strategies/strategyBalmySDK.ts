import {
  type BuildParams,
  type Chain,
  type QuoteRequest,
  type QuoteResponse,
  type QuoteResponseWithTx,
  type SourceId,
  type TimeString,
  buildSDK,
  getAllChains,
} from "@balmy/sdk"
import { buildFetchService } from "@balmy/sdk/dist/sdk/builders/fetch-builder"
import { buildProviderService } from "@balmy/sdk/dist/sdk/builders/provider-builder"
import type { Either } from "@balmy/sdk/dist/utility-types"
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isAddressEqual,
  maxUint256,
  parseAbiParameters,
  parseUnits,
} from "viem"
import { BINARY_SEARCH_TIMEOUT_SECONDS } from "../config/constants"
import { type SwapApiResponseMulticallItem, SwapperMode } from "../interface"
import type { StrategyResult, SwapParams, SwapQuote } from "../types"
import {
  adjustForInterest,
  binarySearchQuote,
  buildApiResponseExactInputFromQuote,
  buildApiResponseSwap,
  buildApiResponseVerifyDebtMax,
  calculateEstimatedAmountFrom,
  encodeApproveMulticallItem,
  encodeTargetDebtAsExactInMulticall,
  isExactInRepay,
  matchParams,
  promiseWithTimeout,
  quoteToRoute,
} from "../utils"
import { CustomSourceList } from "./balmySDK/customSourceList"
import { TokenlistMetadataSource } from "./balmySDK/tokenlistMetadataSource"

const DAO_MULTISIG = "0xcAD001c30E96765aC90307669d578219D4fb1DCe"
const DEFAULT_TIMEOUT = "30000"
// TODO config
const BINARY_SEARCH_EXCLUDE_SOURCES: any = [] // paraswap is rate limited and fails if selected as best source for binary search

type SourcesFilter =
  | Either<
      {
        includeSources: SourceId[]
      },
      {
        excludeSources: SourceId[]
      }
    >
  | undefined

export type BalmyStrategyConfig = {
  referrer: {
    address: Address
    name: string
  }
  timeout: string
  sourcesFilter: SourcesFilter
}

export const defaultConfig: BalmyStrategyConfig = {
  referrer: {
    address: DAO_MULTISIG,
    name: "euler",
  },
  timeout: DEFAULT_TIMEOUT,
  sourcesFilter: undefined,
}

export class StrategyBalmySDK {
  static name() {
    return "balmy_sdk"
  }
  readonly match
  readonly config

  private readonly sdk

  constructor(match = {}, config?: BalmyStrategyConfig) {
    this.config = { ...defaultConfig, ...(config || {}) }
    const fetchService = buildFetchService()
    const providerService = buildProviderService()

    const buildParams: BuildParams = {
      quotes: {
        sourceList: {
          type: "custom",
          instance: new CustomSourceList({ providerService, fetchService }),
        },
        defaultConfig: {
          global: {
            disableValidation: true,
            referrer: this.config.referrer,
          },
          custom: {
            "1inch": {
              apiKey: String(process.env.ONEINCH_API_KEY),
            },
            "li-fi": {
              apiKey: String(process.env.LIFI_API_KEY),
            },
            pendle: {
              apiKey: String(process.env.PENDLE_API_KEY),
            },
            "open-ocean": {
              apiKey: String(process.env.OPENOCEAN_API_KEY),
            },
            "okx-dex": {
              apiKey: String(process.env.OKX_API_KEY),
              secretKey: String(process.env.OKX_SECRET_KEY),
              passphrase: String(process.env.OKX_PASSPHRASE),
            },
            odos: {
              apiKey: String(process.env.ODOS_API_KEY),
              referralCode: Number(process.env.ODOS_REFERRAL_CODE),
            },
            oogabooga: {
              apiKey: String(process.env.OOGABOOGA_API_KEY),
            },
            "0x": {
              apiKey: String(process.env.OX_API_KEY),
            },
            magpie: {
              apiKey: String(process.env.MAGPIE_API_KEY),
            },
            enso: {
              apiKey: String(process.env.ENSO_API_KEY),
            },
          },
        },
      },
      metadata: {
        source: {
          type: "custom",
          instance: new TokenlistMetadataSource(),
        },
      },
      provider: {
        source: {
          type: "public-rpcs",
          rpcsPerChain: combinePublicAndPrivateRPCs(),
          config: {
            type: "fallback",
          },
        },
      },
    } as BuildParams
    this.sdk = buildSDK(buildParams)
    this.match = match
  }

  async supports(swapParams: SwapParams) {
    return (
      !isExactInRepay(swapParams) &&
      (this.sdk.quoteService.supportedChains().includes(swapParams.chainId) ||
        swapParams.chainId === 1923) // TODO fix!
    )
  }

  async findSwap(swapParams: SwapParams): Promise<StrategyResult> {
    const result: StrategyResult = {
      strategy: StrategyBalmySDK.name(),
      supports: await this.supports(swapParams),
      match: matchParams(swapParams, this.match),
    }

    if (!result.supports || !result.match) return result

    try {
      switch (swapParams.swapperMode) {
        case SwapperMode.EXACT_IN: {
          result.quotes = await this.exactIn(swapParams)
          break
        }
        case SwapperMode.TARGET_DEBT: {
          result.quotes = await this.targetDebt(swapParams)
          break
        }
        // case SwapperMode.EXACT_OUT:
        default: {
          result.error = "Unsupported swap mode"
        }
      }
    } catch (error) {
      result.error = error
    }

    return result
  }

  async exactIn(swapParams: SwapParams) {
    const quotes = await this.#getAllQuotesWithTxs(swapParams)
    return quotes.map((q) => {
      const swapQuote = this.#getSwapQuoteFromSDKQuoteWithTx(swapParams, q)
      return buildApiResponseExactInputFromQuote(swapParams, swapQuote)
    })
  }

  async targetDebt(swapParams: SwapParams) {
    const innerSwapParams = {
      ...swapParams,
      receiver: swapParams.from,
      swapperMode: SwapperMode.EXACT_IN,
    }

    const quotes = await this.#binarySearchOverswapQuote(innerSwapParams)

    if (!quotes) throw new Error("Quote not found")

    return quotes.map((quote) => {
      const multicallItems: SwapApiResponseMulticallItem[] = []

      if (quote.allowanceTarget) {
        multicallItems.push(
          encodeApproveMulticallItem(
            swapParams.tokenIn.addressInfo,
            quote.allowanceTarget,
          ),
        )
      }

      // encode as exact in swap, repay and deposit, to redirect deposit to dust account
      multicallItems.push(
        ...encodeTargetDebtAsExactInMulticall(swapParams, quote.data),
      )

      const swap = buildApiResponseSwap(swapParams.from, multicallItems)

      const verify = buildApiResponseVerifyDebtMax(
        swapParams.chainId,
        swapParams.receiver,
        swapParams.accountOut,
        swapParams.targetDebt,
        swapParams.deadline,
      )

      return {
        amountIn: String(quote.amountIn),
        amountInMax: String(quote.amountInMax),
        amountOut: String(quote.amountOut),
        amountOutMin: String(quote.amountOutMin),
        vaultIn: swapParams.vaultIn,
        receiver: swapParams.receiver,
        accountIn: swapParams.accountIn,
        accountOut: swapParams.accountOut,
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        slippage: swapParams.slippage,
        route: quoteToRoute(quote),
        swap,
        verify,
      }
    })
  }

  async #binarySearchOverswapQuote(swapParams: SwapParams) {
    let sourcesFilter
    if (this.config.sourcesFilter?.includeSources) {
      sourcesFilter = {
        includeSources: this.config.sourcesFilter.includeSources.filter(
          (s: string) => !BINARY_SEARCH_EXCLUDE_SOURCES.includes(s),
        ),
      }
    } else if (this.config.sourcesFilter?.excludeSources) {
      sourcesFilter = {
        excludeSources: [
          ...this.config.sourcesFilter.excludeSources,
          ...BINARY_SEARCH_EXCLUDE_SOURCES,
        ],
      }
    } else {
      sourcesFilter = { excludeSources: BINARY_SEARCH_EXCLUDE_SOURCES }
    }
    const swapParamsExactIn = {
      ...swapParams,
      swapperMode: SwapperMode.EXACT_IN,
      receiver: swapParams.from,
      isRepay: false,
    }

    const unitQuotes = await this.#getAllQuotes(
      {
        ...swapParamsExactIn,
        amount: parseUnits("1", swapParams.tokenIn.decimals),
      },
      sourcesFilter,
    )

    const overSwapTarget = adjustForInterest(swapParams.amount)

    const shouldContinue = (currentAmountTo: bigint): boolean =>
      // search until quote is 100 - 100.5% target
      currentAmountTo < overSwapTarget ||
      (currentAmountTo * 1000n) / overSwapTarget > 1005n

    // single run to preselect sources
    const initialQuotesSettled = await Promise.allSettled(
      unitQuotes
        .filter((unitQuote) => unitQuote.minBuyAmount.amount !== 0n)
        .map((unitQuote) => {
          const estimatedAmountIn = calculateEstimatedAmountFrom(
            unitQuote.minBuyAmount.amount,
            swapParamsExactIn.amount,
            swapParamsExactIn.tokenIn.decimals,
            swapParamsExactIn.tokenOut.decimals,
          )
          return this.#getAllQuotes(
            {
              ...swapParams,
              amount: estimatedAmountIn,
            },
            {
              includeSources: [unitQuote.source.id],
            },
          )
        }),
    )
    const initialQuotes = initialQuotesSettled
      .filter((q) => q.status === "fulfilled")
      .flatMap((q) => q.value)

    const allSettled = await Promise.allSettled(
      initialQuotes.map(async (initialQuote) =>
        promiseWithTimeout(async () => {
          const quote = await binarySearchQuote(
            swapParams,
            async (swapParams: SwapParams) => {
              const result = await this.#getAllQuotes(swapParams, {
                includeSources: [initialQuote.source.id],
              })
              return {
                quote: result[0],
                amountTo: result[0].minBuyAmount.amount,
              }
            },
            overSwapTarget,
            initialQuote.sellAmount.amount,
            shouldContinue,
            {
              quote: initialQuote,
              amountTo: initialQuote.minBuyAmount.amount,
            },
          )

          const quoteWithTx = {
            ...quote,
            tx: await this.#getTxForQuote(quote),
          }

          return this.#getSwapQuoteFromSDKQuoteWithTx(swapParams, quoteWithTx)
        }, BINARY_SEARCH_TIMEOUT_SECONDS),
      ),
    )

    const bestQuotes = allSettled
      .filter((q) => q.status === "fulfilled")
      .map((q) => q.value)

    if (bestQuotes.length === 0) throw new Error("Quotes not found")

    return bestQuotes
  }

  //   async #binarySearchOverswapQuote(swapParams: SwapParams) {
  //     const fetchQuote = async (
  //       sp: SwapParams,
  //       sourcesFilter?: SourcesFilter,
  //     ) => {
  //       const quote = await this.#getBestSDKQuote(sp, sourcesFilter)
  //       return {
  //         quote,
  //         amountTo: quote.buyAmount.amount,
  //       }
  //     }

  //     const reverseSwapParams = {
  //       ...swapParams,
  //       tokenIn: swapParams.tokenOut,
  //       tokenOut: swapParams.tokenIn,
  //       swapperMode: SwapperMode.EXACT_IN,
  //     }

  //     let sourcesFilter
  //     if (this.config.sourcesFilter?.includeSources) {
  //       sourcesFilter = {
  //         includeSources: this.config.sourcesFilter.includeSources.filter(
  //           (s) => !BINARY_SEARCH_EXCLUDE_SOURCES.includes(s),
  //         ),
  //       }
  //     } else if (this.config.sourcesFilter?.excludeSources) {
  //       sourcesFilter = {
  //         excludeSources: [
  //           ...this.config.sourcesFilter.excludeSources,
  //           ...BINARY_SEARCH_EXCLUDE_SOURCES,
  //         ],
  //       }
  //     } else {
  //       sourcesFilter = { excludeSources: BINARY_SEARCH_EXCLUDE_SOURCES }
  //     }
  //     const reverseQuote = await fetchQuote(reverseSwapParams, sourcesFilter)
  //     const estimatedAmountIn = reverseQuote.amountTo
  //     if (estimatedAmountIn === 0n) throw new Error("quote not found")

  //     const bestSourceId = reverseQuote.quote.source.id

  //     const overSwapTarget = adjustForInterest(swapParams.amount)

  //     const shouldContinue = (currentAmountTo: bigint): boolean =>
  //       // search until quote is 100 - 100.5% target
  //       currentAmountTo < overSwapTarget ||
  //       (currentAmountTo * 1000n) / overSwapTarget > 1005n

  //     const quote = await binarySearchQuote(
  //       swapParams,
  //       (swapParams: SwapParams) =>
  //         fetchQuote(swapParams, { includeSources: [bestSourceId] }), // preselect single source to avoid oscilations
  //       overSwapTarget,
  //       estimatedAmountIn,
  //       shouldContinue,
  //     )
  //     const quoteWithTx = {
  //       ...quote,
  //       tx: await this.#getTxForQuote(quote),
  //     }

  //     return this.#getSwapQuoteFromSDKQuoteWithTx(swapParams, quoteWithTx)
  //   }

  async #getAllQuotesWithTxs(
    swapParams: SwapParams,
    sourcesFilter?: SourcesFilter,
  ) {
    const quotes = await this.sdk.quoteService.getAllQuotesWithTxs({
      request: this.#getSDKQuoteFromSwapParams(swapParams, sourcesFilter),
      config: {
        timeout: (this.config.timeout as TimeString) || DEFAULT_TIMEOUT,
      },
    })

    return quotes
  }

  async #getAllQuotes(swapParams: SwapParams, sourcesFilter?: SourcesFilter) {
    const quotes = await this.sdk.quoteService.getAllQuotes({
      request: this.#getSDKQuoteFromSwapParams(swapParams, sourcesFilter),
      config: {
        timeout: (this.config.timeout as TimeString) || DEFAULT_TIMEOUT,
      },
    })

    return quotes
  }

  async #getTxForQuote(quote: QuoteResponse) {
    return this.sdk.quoteService.buildTxs({
      quotes: { [quote.source.id]: quote },
    })[quote.source.id]
  }

  #getSDKQuoteFromSwapParams(
    swapParams: SwapParams,
    sourcesFilter?: any,
  ): QuoteRequest {
    return {
      chainId: swapParams.chainId,
      sellToken: swapParams.tokenIn.addressInfo,
      buyToken: swapParams.tokenOut.addressInfo,
      order: {
        ...(swapParams.swapperMode === SwapperMode.EXACT_IN
          ? { type: "sell", sellAmount: swapParams.amount }
          : { type: "buy", buyAmount: swapParams.amount }),
      },
      slippagePercentage: swapParams.slippage,
      takerAddress: swapParams.from,
      recipient: swapParams.receiver,
      filters: sourcesFilter || this.config.sourcesFilter,
      includeNonTransferSourcesWhenRecipientIsSet: true,
    }
  }

  #getSwapQuoteFromSDKQuoteWithTx(
    swapParams: SwapParams,
    sdkQuote: QuoteResponseWithTx,
  ): SwapQuote {
    const data = encodeAbiParameters(parseAbiParameters("address, bytes"), [
      sdkQuote.tx.to as Hex,
      sdkQuote.tx.data as Hex,
    ])

    const sources = this.sdk.quoteService.supportedSources()
    const shouldTransferToReceiver =
      !sources[sdkQuote.source.id].supports.swapAndTransfer
    const allowanceTarget =
      isAddress(sdkQuote.source.allowanceTarget) &&
      !isAddressEqual(sdkQuote.source.allowanceTarget, sdkQuote.tx.to as Hex)
        ? getAddress(sdkQuote.source.allowanceTarget)
        : undefined

    return {
      swapParams,
      amountIn: sdkQuote.sellAmount.amount,
      amountInMax: sdkQuote.maxSellAmount.amount,
      amountOut: sdkQuote.buyAmount.amount,
      amountOutMin: sdkQuote.minBuyAmount.amount,
      data,
      protocol: sdkQuote.source.name,
      shouldTransferToReceiver,
      allowanceTarget,
    }
  }
}

function combinePublicAndPrivateRPCs() {
  const rpcs = Object.fromEntries(
    getAllChains()
      .filter(
        (chain): chain is Chain & { publicRPCs: string[] } =>
          chain.publicRPCs.length > 0,
      )
      .map(({ chainId, publicRPCs }) => [chainId, publicRPCs]),
  )

  const envRPCs = Object.entries(process.env).filter(([key]) =>
    /^RPC_URL_/.test(key),
  )

  for (const [key, val] of envRPCs) {
    if (typeof val !== "string") return
    const chainId = Number(key.split("_").at(-1))
    if (!rpcs[chainId]) rpcs[chainId] = []
    if (!rpcs[chainId].includes(val)) rpcs[chainId].unshift(val)
  }

  return rpcs
}
