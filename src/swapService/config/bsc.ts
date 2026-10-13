import { bsc } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const bscConfig: ChainConfig = {
  chain: bsc,
  aggregators: {
    "0x": true,
    "1inch": true,
    "binance-wallet": true,
    enso: true,
    kyberswap: { chainKey: "bsc" },
    "li-fi": true,
    magpie: { network: "bsc" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
    paraswap: true,
    spectra: { network: "bsc" },
    uniswap: { router: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2" },
  },
}

export default bscConfig
