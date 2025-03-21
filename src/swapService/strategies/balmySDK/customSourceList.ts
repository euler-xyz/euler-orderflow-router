import { LOG_SLOW_QUERY_TIMEOUT_SECONDS } from "@/swapService/config/constants"
import type {
  IFetchService,
  IProviderService,
  SourceId,
  SourceListQuoteRequest,
  SourceListQuoteResponse,
} from "@balmy/sdk"
import { LocalSourceList } from "@balmy/sdk/dist/services/quotes/source-lists/local-source-list"
import { CustomKyberswapQuoteSource } from "./sources/kyberswapQuoteSource"
import { CustomLiFiQuoteSource } from "./sources/lifiQuoteSource"
import { CustomMagpieQuoteSource } from "./sources/magpieQuoteSource"
import { CustomNeptuneQuoteSource } from "./sources/neptuneQuoteSource"
import { CustomOdosQuoteSource } from "./sources/odosQuoteSource"
import { CustomOkuQuoteSource } from "./sources/okuQuoteSource"
import { CustomOneInchQuoteSource } from "./sources/oneInchQuoteSource"
import { CustomOogaboogaQuoteSource } from "./sources/oogaboogaQuoteSource"
import { CustomOpenOceanQuoteSource } from "./sources/openOceanQuoteSource"
import { CustomPendleQuoteSource } from "./sources/pendleQuoteSource"
import { CustomUniswapQuoteSource } from "./sources/uniswapQuoteSource"

type ConstructorParameters = {
  providerService: IProviderService
  fetchService: IFetchService
}

const customSources = {
  "1inch": new CustomOneInchQuoteSource(),
  "li-fi": new CustomLiFiQuoteSource(),
  pendle: new CustomPendleQuoteSource(),
  "open-ocean": new CustomOpenOceanQuoteSource(),
  neptune: new CustomNeptuneQuoteSource(),
  odos: new CustomOdosQuoteSource(),
  oogabooga: new CustomOogaboogaQuoteSource(),
  uniswap: new CustomUniswapQuoteSource(),
  magpie: new CustomMagpieQuoteSource(),
  kyberswap: new CustomKyberswapQuoteSource(),
  oku_bob_icecreamswap: new CustomOkuQuoteSource(
    "icecreamswap",
    "IceCreamSwap",
    [60808],
  ),
  oku_bob_uniswap: new CustomOkuQuoteSource("usor", "Uniswap", [60808]),
}
export class CustomSourceList extends LocalSourceList {
  constructor({ providerService, fetchService }: ConstructorParameters) {
    super({ providerService, fetchService })

    const mutableThis = this as any
    mutableThis.sources = {
      ...mutableThis.sources,
      ...customSources,
    }
    delete mutableThis.sources.balmy

    // wrap getQuote in timer
    const getQuoteSuper = mutableThis.getQuote.bind(this)

    mutableThis.getQuote = async (
      request: SourceListQuoteRequest,
      sourceId: SourceId,
    ): Promise<SourceListQuoteResponse> => {
      const startTime = process.hrtime()
      const result = await getQuoteSuper(request, sourceId)
      const elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime))
      // if (elapsedSeconds > LOG_SLOW_QUERY_TIMEOUT_SECONDS) {
      //   const { chainId, sellToken, buyToken, order } = request
      //   const requestGist = {
      //     chainId,
      //     sellToken,
      //     buyToken,
      //     order,
      //   }
      //   console.log(
      //     `SLOW QUERY: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
      //   )
      // }
      const { chainId, sellToken, buyToken, order } = request
      const requestGist = {
        chainId,
        sellToken,
        buyToken,
        order,
      }
      console.log(
        `QUERY EXECUTING: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
      )
      if (elapsedSeconds > 10) {
        console.log(
          `SLOW QUERY [10]: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
        )
      } else if (elapsedSeconds > 5) {
        console.log(
          `SLOW QUERY [5]: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
        )
      } else if (elapsedSeconds > 3) {
        console.log(
          `SLOW QUERY [3]: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
        )
      } else if (elapsedSeconds > 1) {
        console.log(
          `SLOW QUERY [1]: ${sourceId} ${elapsedSeconds}s ${stringify(requestGist)}`,
        )
      }

      return result
    }
  }
}

function parseHrtimeToSeconds(hrtime: [number, number]) {
  return Number((hrtime[0] + hrtime[1] / 1e9).toFixed(3))
}

function stringify(obj: object) {
  return JSON.stringify(obj, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  )
}
