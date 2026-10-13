import { sonic } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const sonicConfig: ChainConfig = {
  chain: sonic,
  aggregators: {
    enso: true,
    kyberswap: { chainKey: "sonic" },
    magpie: { network: "sonic" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
    spectra: { network: "sonic" },
  },
}

export default sonicConfig
