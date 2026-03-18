import type { Address } from "viem"
import * as chains from "viem/chains"

type Deployment = {
  chainId: number
  addresses?: {
    peripheryAddrs?: {
      swapper?: Address
      swapVerifier?: Address
    }
  }
}

const DEFAULT_DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/EulerChains.json"
const CONTRACT_BOOK_CACHE_TIMEOUT_MS =
  Number(process.env.CONTRACT_BOOK_CACHE_TIMEOUT_SECONDS || 12 * 60 * 60) * 1000

const contractBook: any = {
  swapper: {
    abi: require("./abi/Swapper.json"),
    address: {
      [chains.mainnet.id]: "0x719F8b330CcA71cb6195D032A43194C7D3F9Fb45",
      [chains.base.id]: "0xd54d9Fc684169287f34DA6d57Aa002B424eEbC05",
      [chains.polygon.id]: "0x65E0aBbf3F3Fd06dBd01D6B9D28d0ea7A2f2Dccf",
      [chains.avalanche.id]: "0x065D7B495D25436E492fE57116665894Bfe17157",
      [chains.bsc.id]: "0x8e39500a6672D701616ED4943a5Cc5C79Ab38643",
      [chains.swellchain.id]: "0x7212F011bbB3d1a04F20a548b0048cEad4dA9f42",
      [chains.sonic.id]: "0x2cb79cdA6Bb09A901177D5227b4aA1584Dbcfc9B",
      [chains.berachain.id]: "0x83Ee58fE951bb0133F4E30D61863988378CD665E",
      [chains.unichain.id]: "0xDF3009390D10dC18a8f8B42402F1541c7235DfB4",
      [chains.bob.id]: "0xB5949BcaF4BC1bC0ef2D132A4A2Ec5cf4D5934CD",
      [chains.tac.id]: "0x9817C2CB138593639ae7C124893A1C1F75657B42",
      [chains.arbitrum.id]: "0x4AaA129FaD81a65Dab41b1fa7e964CBB9B30C848",
      [chains.linea.id]: "0x6dE68A54105451FE9e88d44659a32291dC3959F9",
      [chains.plasma.id]: "0x8B8Ce23C9BbB2c26BA322Ec1Aa266BAF6226ccc0",
      [chains.monad.id]: "0x41B8Ec27c640DbD0299A0083fAc8fE0099648bdB",
    },
  },
  swapVerifier: {
    abi: require("./abi/SwapVerifier.json"),
    address: {
      [chains.mainnet.id]: "0x786c900d7D348662703C38B46f24c1cda2C582AB",
      [chains.base.id]: "0xF8B2d2BA412E24235eAaDa8d3050202898455455",
      [chains.polygon.id]: "0xF86a955d82f83E2412A9902Cc3Fd15b750cFD992",
      [chains.avalanche.id]: "0x768B74A19115316c1A782fFa335FdfBb66278174",
      [chains.bsc.id]: "0xc0126DE6e1615479b357e2Fef6d423FB2FBEe502",
      [chains.swellchain.id]: "0x605280f2F939255Ab36FaFdBC654dE3cfbD5c616",
      [chains.sonic.id]: "0x84354221A6C432a9907F4D0777d8e794646206da",
      [chains.berachain.id]: "0xE5cca51c93BF775cc176A45e28487026da777800",
      [chains.unichain.id]: "0xDAd370C74A9Fe7e6bfd55De69Baf81060e51eab4",
      [chains.bob.id]: "0x5cb5C6F2c0147a337d476A71c2d2897f2B3A8f80",
      [chains.tac.id]: "0xD5115592F042a120cf94B506b23cac81994f677B",
      [chains.arbitrum.id]: "0xcB4cbC3128b38d6Ca46b7676D2389fAfa6009c1f",
      [chains.linea.id]: "0x9e1D192f39489f7230Fc71aB89151a8c5A031cF0",
      [chains.plasma.id]: "0xcB80Af483ecA49e5ca7d4DBa2F24D01E9f0be289",
      [chains.monad.id]: "0x392812023A2Ef4F20DE5AA9f7b7e2F02E9692Ba7",
    },
  },
}

let refreshPromise: Promise<void> | null = null

async function queryDeployments(url: string): Promise<Deployment[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch deployments: ${response.status} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) {
    throw new Error("Invalid deployment data format")
  }

  return data as Deployment[]
}

export async function refreshContractBookAddresses() {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const deployments = await queryDeployments(
      process.env.DEPLOYMENTS_URL || DEFAULT_DEPLOYMENTS_URL,
    )

    for (const deployment of deployments) {
      const peripheryAddrs = deployment.addresses?.peripheryAddrs
      if (peripheryAddrs?.swapper) {
        contractBook.swapper.address[deployment.chainId] =
          peripheryAddrs.swapper
      }
      if (peripheryAddrs?.swapVerifier) {
        contractBook.swapVerifier.address[deployment.chainId] =
          peripheryAddrs.swapVerifier
      }
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export function initContractBookCache() {
  setInterval(() => {
    void refreshContractBookAddresses().catch((error) => {
      console.warn("Error refreshing contractBook addresses", error)
    })
  }, CONTRACT_BOOK_CACHE_TIMEOUT_MS)
}

export default contractBook
