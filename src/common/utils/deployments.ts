import { DeploymentService } from "@eulerxyz/euler-v2-sdk"
import type { Address } from "viem"
import { RPC_URLS } from "./viemClients"

const DEFAULT_DEPLOYMENTS_URL =
  "https://raw.githubusercontent.com/euler-xyz/euler-interfaces/refs/heads/master/EulerChains.json"

let deploymentService: DeploymentService | null = null

// Fetch deployments once at startup. Throws if the source is unavailable so the
// process fails fast rather than serving swaps without contract addresses.
export async function loadDeployments() {
  deploymentService = await DeploymentService.build({
    deploymentsUrl: process.env.DEPLOYMENTS_URL || DEFAULT_DEPLOYMENTS_URL,
  })
}

function getPeripheryAddress(
  chainId: number,
  key: "swapper" | "swapVerifier",
): Address {
  if (!deploymentService) {
    throw new Error("Deployments not loaded")
  }
  if (
    !(chainId in RPC_URLS) ||
    !deploymentService.getDeploymentChainIds().includes(chainId)
  ) {
    throw new Error(`${key} contract not found for chainId ${chainId}`)
  }
  const address =
    deploymentService.getDeployment(chainId).addresses.peripheryAddrs?.[key]
  if (!address) {
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
