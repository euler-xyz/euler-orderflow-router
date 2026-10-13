import { hyperEvm } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const hyperevmConfig: ChainConfig = {
  chain: hyperEvm,
  aggregators: {
    enso: true,
    kyberswap: { chainKey: "hyperevm" },
    "li-fi": true,
    nordstern: true,
    "open-ocean": {
      nativeAsset: "0x0000000000000000000000000000000000000000",
    },
    spectra: { network: "hyperevm" },
  },
}

export default hyperevmConfig
