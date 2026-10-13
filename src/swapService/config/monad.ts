import { monad } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const monadConfig: ChainConfig = {
  chain: monad,
  aggregators: {
    enso: true,
    kyberswap: { chainKey: "monad" },
    magpie: { network: "monad" },
    nordstern: true,
    "open-ocean": true,
  },
}

export default monadConfig
