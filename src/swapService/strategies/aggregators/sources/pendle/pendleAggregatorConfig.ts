import { logWarn } from "@/common/utils/logs"
import { z } from "zod"
import fallbackAggregators from "./pendleAggregators.json"

const API_URL = "https://api-v2.pendle.finance/core/v1"
const STARTUP_TIMEOUT_MS = 5_000
const chainsSchema = z.object({
  chainIds: z.array(z.number().int().positive()),
})
const aggregatorsSchema = z.object({
  aggregators: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/) })),
})

type PendleAggregators = Readonly<Record<number, readonly string[]>>
let aggregators: PendleAggregators = fallbackAggregators

export function getPendleAggregators(): PendleAggregators {
  return aggregators
}

export async function initPendleAggregators(configuredChainIds: number[]) {
  const signal = AbortSignal.timeout(STARTUP_TIMEOUT_MS)
  const supportedChains = new Set(Object.keys(fallbackAggregators).map(Number))
  const next: Record<number, readonly string[]> = { ...aggregators }

  try {
    const response = await fetch(`${API_URL}/chains`, { signal })
    if (!response.ok)
      throw new Error(`Pendle chains returned ${response.status}`)
    const { chainIds } = chainsSchema.parse(await response.json())
    for (const chainId of chainIds) supportedChains.add(chainId)
  } catch (error) {
    logWarn({
      name: "Failed to discover Pendle chains; using known chains",
      error,
    })
  }

  await Promise.all(
    [...new Set(configuredChainIds)]
      .filter((chainId) => supportedChains.has(chainId))
      .map(async (chainId) => {
        try {
          const response = await fetch(
            `${API_URL}/sdk/${chainId}/supported-aggregators`,
            { signal },
          )
          if (!response.ok)
            throw new Error(`Pendle aggregators returned ${response.status}`)
          const data = aggregatorsSchema.parse(await response.json())
          next[chainId] = [...new Set(data.aggregators.map(({ name }) => name))]
        } catch (error) {
          logWarn({
            name: "Failed to refresh Pendle aggregators; keeping fallback",
            chainId,
            error,
          })
        }
      }),
  )

  aggregators = next
}
