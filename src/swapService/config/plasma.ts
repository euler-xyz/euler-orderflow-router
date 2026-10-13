import { plasma } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const plasmaConfig: ChainConfig = {
  chain: plasma,
  aggregators: {
    "0x": true,
    enso: true,
    kyberswap: { chainKey: "plasma" },
    magpie: { network: "plasma" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
  },
}

export default plasmaConfig
