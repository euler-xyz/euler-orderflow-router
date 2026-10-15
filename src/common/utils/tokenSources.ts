import { getAddress, isAddress, zeroAddress } from "viem"
import { logWarn } from "./logs"
import type { TokenListItem } from "./tokenList"

const TIMEOUT_MS =
  Number(process.env.TOKENLIST_FETCH_TIMEOUT_SECONDS || 30) * 1000
const TTL_MS = Number(process.env.TOKENLIST_CACHE_TIMEOUT_SECONDS || 300) * 1000
const UNISWAP_URL =
  "https://unpkg.com/@uniswap/default-token-list@latest/build/uniswap-default.tokenlist.json"
const DEFILLAMA_URL = "https://d3g10bzo9rdluh.cloudfront.net"

export function normalizeListedToken(
  value: unknown,
  chainId: number,
): TokenListItem | undefined {
  if (!value || typeof value !== "object") return
  const token = value as Record<string, unknown>
  if (
    Number(token.chainId) !== chainId ||
    typeof token.address !== "string" ||
    !isAddress(token.address) ||
    token.address.toLowerCase() === zeroAddress
  )
    return
  if (
    typeof token.name !== "string" ||
    typeof token.symbol !== "string" ||
    !Number.isInteger(token.decimals) ||
    Number(token.decimals) < 0 ||
    Number(token.decimals) > 255
  )
    return
  return {
    chainId,
    address: getAddress(token.address),
    name: token.name,
    symbol: token.symbol,
    decimals: Number(token.decimals),
    logoURI: typeof token.logoURI === "string" ? token.logoURI : "",
  }
}

async function fetchJSON(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Token source returned ${response.status}`)
  return response.json() as Promise<unknown>
}

let uniswapCache: { tokens: unknown[]; timestamp: number } | undefined
let uniswapPromise: Promise<unknown[]> | undefined

function fetchUniswap() {
  if (uniswapCache && Date.now() - uniswapCache.timestamp < TTL_MS)
    return Promise.resolve(uniswapCache.tokens)
  if (!uniswapPromise) {
    uniswapPromise = fetchJSON(
      process.env.UNISWAP_TOKEN_LIST_URL || UNISWAP_URL,
    )
      .then((data) => {
        const tokens = (data as { tokens?: unknown[] } | null)?.tokens
        if (!Array.isArray(tokens))
          throw new Error("Invalid Uniswap token list")
        uniswapCache = { tokens, timestamp: Date.now() }
        return tokens
      })
      .catch((error) => {
        if (uniswapCache) return uniswapCache.tokens
        throw error
      })
      .finally(() => {
        uniswapPromise = undefined
      })
  }
  return uniswapPromise
}

export async function fetchFallbackTokens(
  chainId: number,
): Promise<TokenListItem[]> {
  const baseUrl = (
    process.env.DEFILLAMA_TOKEN_LIST_URL || DEFILLAMA_URL
  ).replace(/\/$/, "")
  const results = await Promise.allSettled([
    fetchJSON(`${baseUrl}/tokenlists-${chainId}.json`).then((data) => {
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid DefiLlama token list")
      return Object.values(data).map((value) => {
        if (!value || typeof value !== "object") return undefined
        const token = value as Record<string, unknown>
        return {
          ...token,
          chainId: token.chainId ?? chainId,
          logoURI: token.logoURI ?? token.logoURI2,
        }
      })
    }),
    fetchUniswap(),
  ])
  const tokens = new Map<string, TokenListItem>()
  for (const result of results) {
    if (result.status === "rejected") {
      logWarn({
        name: `Token discovery source failed for chain ${chainId}`,
        error: result.reason,
      })
      continue
    }
    for (const raw of result.value) {
      const token = normalizeListedToken(raw, chainId)
      if (token && !tokens.has(token.address.toLowerCase()))
        tokens.set(token.address.toLowerCase(), token)
    }
  }
  return [...tokens.values()]
}

type RoutingMetadata = NonNullable<TokenListItem["metadata"]>
type PendleMarket = { chainId?: number; address?: string; pt?: string }
const pendleCache = new Map<
  number,
  { metadata: Map<string, RoutingMetadata>; timestamp: number }
>()
const pendlePromises = new Map<number, Promise<Map<string, RoutingMetadata>>>()

export function fetchPendleMetadata(chainId: number) {
  const cached = pendleCache.get(chainId)
  if (cached && Date.now() - cached.timestamp < TTL_MS)
    return Promise.resolve(cached.metadata)
  const pending = pendlePromises.get(chainId)
  if (pending) return pending
  const promise = (async () => {
    const metadata = new Map<string, RoutingMetadata>()
    let skip = 0
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    while (true) {
      const url = new URL(
        process.env.PENDLE_MARKETS_URL ||
          "https://api-v2.pendle.finance/core/v2/markets/all",
      )
      url.searchParams.set("chainId", String(chainId))
      url.searchParams.set("limit", "100")
      url.searchParams.set("skip", String(skip))
      const response = await fetch(url.toString(), { signal })
      if (!response.ok)
        throw new Error(`Pendle markets returned ${response.status}`)
      const data = (await response.json()) as {
        total?: number
        skip?: number
        results?: PendleMarket[]
      }
      if (
        !Array.isArray(data.results) ||
        !Number.isInteger(data.total) ||
        Number(data.total) < 0 ||
        (data.skip !== undefined && data.skip !== skip)
      )
        throw new Error("Invalid Pendle market response")
      if (!data.results.length && skip < Number(data.total))
        throw new Error("Incomplete Pendle market response")
      for (const market of data.results) {
        if (
          market.chainId !== chainId ||
          !market.address ||
          !isAddress(market.address) ||
          market.address.toLowerCase() === zeroAddress
        )
          continue
        const pt = market.pt?.startsWith(`${chainId}-`)
          ? market.pt.slice(String(chainId).length + 1)
          : undefined
        if (pt && isAddress(pt) && pt.toLowerCase() !== zeroAddress) {
          const previous = metadata.get(pt.toLowerCase())
          const pendleMarket =
            previous && previous.pendleMarket !== market.address
              ? undefined
              : market.address
          metadata.set(pt.toLowerCase(), {
            isPendlePT: true,
            isPendleLP: false,
            ...(pendleMarket ? { pendleMarket } : {}),
          })
        }
        metadata.set(market.address.toLowerCase(), {
          isPendlePT: false,
          isPendleLP: true,
          pendleMarket: market.address,
        })
      }
      skip += data.results.length
      if (skip >= Number(data.total)) break
    }

    try {
      const url = new URL(
        process.env.PENDLE_ASSETS_URL ||
          "https://api-v2.pendle.finance/core/v1/assets/all",
      )
      url.searchParams.set("chainId", String(chainId))
      url.searchParams.set("type", "PT")
      // Omitting limit requests the full asset catalog, including unlisted markets.
      const response = await fetch(url.toString(), { signal })
      if (!response.ok)
        throw new Error(`Pendle assets returned ${response.status}`)
      const data = (await response.json()) as { assets?: unknown[] } | null
      if (!Array.isArray(data?.assets))
        throw new Error("Invalid Pendle asset response")
      for (const raw of data.assets) {
        if (!raw || typeof raw !== "object") continue
        const asset = raw as {
          chainId?: number
          address?: unknown
          tags?: unknown
        }
        if (
          asset.chainId !== chainId ||
          typeof asset.address !== "string" ||
          !isAddress(asset.address) ||
          asset.address.toLowerCase() === zeroAddress ||
          !Array.isArray(asset.tags) ||
          !asset.tags.includes("PT")
        )
          continue
        const address = asset.address.toLowerCase()
        if (!metadata.has(address))
          metadata.set(address, { isPendlePT: true, isPendleLP: false })
      }
    } catch (error) {
      logWarn({
        name: `Pendle asset discovery failed for chain ${chainId}`,
        error,
      })
      for (const [address, previous] of cached?.metadata ?? []) {
        if (
          previous.isPendlePT &&
          !previous.pendleMarket &&
          !metadata.has(address)
        )
          metadata.set(address, previous)
      }
    }

    pendleCache.set(chainId, { metadata, timestamp: Date.now() })
    return metadata
  })()
    .catch((error) => {
      logWarn({
        name: `Pendle token discovery failed for chain ${chainId}`,
        error,
      })
      const metadata = cached?.metadata ?? new Map<string, RoutingMetadata>()
      pendleCache.set(chainId, { metadata, timestamp: Date.now() })
      return metadata
    })
    .finally(() => {
      pendlePromises.delete(chainId)
    })
  pendlePromises.set(chainId, promise)
  return promise
}
