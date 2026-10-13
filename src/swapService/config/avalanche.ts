import { avalanche } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const avalancheConfig: ChainConfig = {
  chain: avalanche,
  aggregators: {
    "0x": true,
    "1inch": true,
    "binance-wallet": true,
    enso: true,
    kyberswap: { chainKey: "avalanche" },
    "li-fi": true,
    magpie: { network: "avalanche" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": {
      nativeAsset: "0x0000000000000000000000000000000000000000",
    },
    paraswap: true,
    spectra: { network: "avalanche" },
    uniswap: { router: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE" },
  },
}

export default avalancheConfig
