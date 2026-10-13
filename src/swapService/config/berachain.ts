import { berachain } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const berachainConfig: ChainConfig = {
  chain: berachain,
  aggregators: {
    enso: true,
    "li-fi": true,
    magpie: { network: "berachain" },
    nordstern: true,
    oogabooga: true,
    "open-ocean": true,
  },
}

export default berachainConfig
