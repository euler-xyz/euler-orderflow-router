import type { Address, Chain } from "viem"

export type AggregatorChainSettings = {
  "0x": true
  "1inch": true
  "binance-wallet": true
  enso: true
  kyberswap: { chainKey: string }
  "li-fi": true
  magpie: { network: string }
  multiliquid: true
  nordstern: true
  "okx-dex": true
  oku: { chainKey: string; permit2Adapter: Address }
  oogabooga: true
  "open-ocean": true | { nativeAsset: Address }
  paraswap: true
  spectra: { network: string }
  uniswap: { router: Address }
}

export type AggregatorId = keyof AggregatorChainSettings

export type ChainConfig = {
  chain: Chain
  aggregators: Partial<AggregatorChainSettings>
}
