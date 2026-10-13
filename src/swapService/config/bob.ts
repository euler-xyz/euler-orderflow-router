import { bob } from "viem/chains"
import type { ChainConfig } from "./chainConfig"

const bobConfig: ChainConfig = {
  chain: bob,
  aggregators: {
    nordstern: true,
    oku: {
      chainKey: "bob",
      permit2Adapter: "0x867c17C297083cD7d73B39C89e4602878C4Caa65",
    },
  },
}

export default bobConfig
