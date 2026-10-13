import { base } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const baseConfig: ChainConfig = {
  chain: base,
  aggregators: {
    "0x": true,
    "1inch": true,
    "binance-wallet": true,
    enso: true,
    kyberswap: { chainKey: "base" },
    "li-fi": true,
    magpie: { network: "base" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
    paraswap: true,
    spectra: { network: "base" },
    uniswap: { router: "0x2626664c2603336E57B271c5C0b26F421741e481" },
  },
}

export default baseConfig
