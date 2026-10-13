import { mainnet } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const mainnetConfig: ChainConfig = {
  chain: mainnet,
  aggregators: {
    "0x": true,
    "1inch": true,
    "binance-wallet": true,
    enso: true,
    kyberswap: { chainKey: "ethereum" },
    "li-fi": true,
    magpie: { network: "ethereum" },
    multiliquid: true,
    nordstern: true,
    "okx-dex": true,
    "open-ocean": true,
    paraswap: true,
    spectra: { network: "mainnet" },
    uniswap: { router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" },
  },
}

export default mainnetConfig
