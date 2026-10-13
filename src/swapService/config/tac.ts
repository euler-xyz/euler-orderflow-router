import { tac } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const tacConfig: ChainConfig = {
  chain: tac,
  aggregators: {
    nordstern: true,
    "open-ocean": true, // fix gas price
  },
}

export default tacConfig
