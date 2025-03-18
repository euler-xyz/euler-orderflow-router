import type { IFetchService, IProviderService } from "@balmy/sdk"
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
  }
}
