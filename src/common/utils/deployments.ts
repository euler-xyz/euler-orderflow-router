import { DeploymentService } from "@eulerxyz/euler-v2-sdk"
import type { Address } from "viem"
import contractBook from "./contractBook"
import { logWarn } from "./logs"
import { RPC_URLS } from "./viemClients"

const DEFAULT_DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/EulerChains.json"
const CONTRACT_BOOK_CACHE_TIMEOUT_MS =
  Number(process.env.CONTRACT_BOOK_CACHE_TIMEOUT_SECONDS || 12 * 60 * 60) * 1000

let refreshPromise: Promise<void> | null = null

export function loadDeployments(): Promise<void> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const deploymentService = await DeploymentService.build({
      deploymentsUrl: process.env.DEPLOYMENTS_URL || DEFAULT_DEPLOYMENTS_URL,
    })

    for (const chainId of deploymentService.getDeploymentChainIds()) {
      if (!(chainId in RPC_URLS)) continue
      const peripheryAddrs =
        deploymentService.getDeployment(chainId).addresses?.peripheryAddrs
      if (peripheryAddrs?.swapper) {
        contractBook.swapper.address[chainId] = peripheryAddrs.swapper
      }
      if (peripheryAddrs?.swapVerifier) {
        contractBook.swapVerifier.address[chainId] = peripheryAddrs.swapVerifier
      }
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export function initContractBookCache() {
  return setInterval(() => {
    void loadDeployments().catch((error) => {
      logWarn({ name: "Error refreshing contractBook addresses", error })
    })
  }, CONTRACT_BOOK_CACHE_TIMEOUT_MS)
}

function getPeripheryAddress(
  chainId: number,
  key: "swapper" | "swapVerifier",
): Address {
  const address = contractBook[key].address[chainId]
  if (!(chainId in RPC_URLS) || !address) {
    throw new Error(`${key} contract not found for chainId ${chainId}`)
  }
  return address
}

export function getSwapperAddress(chainId: number): Address {
  return getPeripheryAddress(chainId, "swapper")
}

export function getSwapVerifierAddress(chainId: number): Address {
  return getPeripheryAddress(chainId, "swapVerifier")
}
