import { arbitrum } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const arbitrumConfig: ChainConfig = {
  chain: arbitrum,
  aggregators: {
    "0x": true,
    "1inch": true,
    "binance-wallet": true,
    enso: true,
    kyberswap: { chainKey: "arbitrum" },
    "li-fi": true,
    magpie: { network: "arbitrum" },
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
    paraswap: true,
    spectra: { network: "arbitrum" },
    uniswap: { router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
  },
}

export default arbitrumConfig
