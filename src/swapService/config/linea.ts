import { linea } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const lineaConfig: ChainConfig = {
  chain: linea,
  aggregators: {
    "0x": true,
    kyberswap: { chainKey: "linea" },
    "li-fi": true,
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
  },
}

export default lineaConfig
