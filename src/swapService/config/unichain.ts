import { unichain } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const unichainConfig: ChainConfig = {
  chain: unichain,
  aggregators: {
    "0x": true,
    enso: true,
    kyberswap: { chainKey: "unichain" },
    "li-fi": true,
    magpie: { network: "unichain" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true, // fix gas price
    paraswap: true,
    uniswap: { router: "0x73855d06de49d0fe4a9c42636ba96c62da12ff9c" },
  },
}

export default unichainConfig
