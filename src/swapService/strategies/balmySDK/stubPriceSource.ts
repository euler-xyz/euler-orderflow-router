import type { ChainId, IProviderService, TimeString, Timestamp, TokenAddress } from "@balmy/sdk"
import type {
  IPriceSource,
  PriceInput,
  PriceResult,
  PricesQueriesSupport,
} from "@balmy/sdk/dist/services/prices/types"

// Stub out price lookups — returns no prices so that USD conversions
// gracefully resolve to undefined instead of hitting external APIs.
export class StubPriceSource implements IPriceSource {
  constructor(private readonly providerService: IProviderService) {}

  supportedQueries(): Record<ChainId, PricesQueriesSupport> {
    const support: PricesQueriesSupport = {
      getCurrentPrices: true,
      getHistoricalPrices: false,
      getBulkHistoricalPrices: false,
      getChart: false,
    }
    return Object.fromEntries(
      this.providerService
        .supportedChains()
        .map((chainId) => [Number(chainId), support]),
    )
  }

  async getCurrentPrices(_: {
    tokens: PriceInput[]
    config: { timeout?: TimeString } | undefined
  }): Promise<Record<ChainId, Record<TokenAddress, PriceResult>>> {
    return {}
  }

  async getHistoricalPrices(_: {
    tokens: PriceInput[]
    timestamp: Timestamp
    searchWidth: TimeString | undefined
    config: { timeout?: TimeString } | undefined
  }): Promise<Record<ChainId, Record<TokenAddress, PriceResult>>> {
    return {}
  }

  async getBulkHistoricalPrices(_: {
    tokens: { chainId: ChainId; token: TokenAddress; timestamp: Timestamp }[]
    searchWidth: TimeString | undefined
    config: { timeout?: TimeString } | undefined
  }): Promise<Record<ChainId, Record<TokenAddress, Record<Timestamp, PriceResult>>>> {
    return {}
  }

  async getChart(_: {
    tokens: PriceInput[]
    span: number
    period: TimeString
    bound: { from: Timestamp } | { upTo: Timestamp | "now" }
    searchWidth?: TimeString
    config: { timeout?: TimeString } | undefined
  }): Promise<Record<ChainId, Record<TokenAddress, PriceResult[]>>> {
    return {}
  }
}
