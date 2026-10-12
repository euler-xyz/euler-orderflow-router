import {
  http,
  type Address,
  createPublicClient,
  hexToString,
  isAddressEqual,
  parseAbi,
  publicActions,
} from "viem"
import customTokens from "../config/customTokens.json"
import { logWarn } from "./logs"
import { RPC_URLS } from "./viemClients"

export type TokenListItem = {
  address: Address
  chainId: number
  decimals: number
  logoURI: string
  name: string
  symbol: string
  metadata?: {
    poolId?: string
    isPendlePT?: boolean
    pendleMarket?: string
    isPendleCrossChainPT?: boolean
    pendleCrossChainPTPaired?: string
    isPendleLP?: boolean
    isPendleWrappedLP?: boolean
    isSpectraPT?: boolean
    spectraPool?: string
  }
}

const cache: Record<number, TokenListItem[]> = {}
const pendingTokenFetches = new Map<
  string,
  Promise<TokenListItem | undefined>
>()
const TOKENLIST_FETCH_TIMEOUT_MS =
  Number(process.env.TOKENLIST_FETCH_TIMEOUT_SECONDS || 30) * 1000
const TOKENLIST_PAGE_SIZE = 500

const erc20StringAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
])
const erc20Bytes32Abi = parseAbi([
  "function name() view returns (bytes32)",
  "function symbol() view returns (bytes32)",
])
const erc20DecimalsAbi = parseAbi(["function decimals() view returns (uint8)"])

const mergeCustomTokens = () => {
  for (const token of customTokens as TokenListItem[]) {
    const chainTokens = cache[token.chainId]
    if (!chainTokens) continue
    if (
      !chainTokens.some((cachedToken) =>
        isAddressEqual(cachedToken.address, token.address),
      )
    ) {
      chainTokens.push(token)
    }
  }
}

type NormalizedTokenListResponse = {
  tokenlist: TokenListItem[]
  meta?: {
    total?: number
    offset?: number
    limit?: number
  }
}

const normalizeTokenListResponse = (
  response: unknown,
): NormalizedTokenListResponse => {
  if (Array.isArray(response)) return { tokenlist: response as TokenListItem[] }

  if (response && typeof response === "object") {
    const typedResponse = response as {
      data?: unknown
      error?: unknown
      meta?: unknown
      success?: boolean | string
    }

    if (typedResponse.success === false || typedResponse.success === "false") {
      throw new Error(JSON.stringify(typedResponse.error ?? typedResponse))
    }

    if (Array.isArray(typedResponse.data)) {
      return {
        tokenlist: typedResponse.data as TokenListItem[],
        meta:
          typedResponse.meta && typeof typedResponse.meta === "object"
            ? (typedResponse.meta as NormalizedTokenListResponse["meta"])
            : undefined,
      }
    }
  }

  throw new Error("Invalid tokenlist response format")
}

const buildTokenListURL = (
  url: string,
  params: { chainId: string; limit?: number; offset?: number },
) => {
  const tokenListURL = new URL(url)
  tokenListURL.searchParams.set("chainId", params.chainId)
  if (params.limit !== undefined) {
    tokenListURL.searchParams.set("limit", String(params.limit))
  }
  if (params.offset !== undefined) {
    tokenListURL.searchParams.set("offset", String(params.offset))
  }
  return tokenListURL.toString()
}

async function fetchTokenListPage(
  url: string,
  chainId: string,
  offset: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    buildTokenListURL(url, {
      chainId,
      limit: TOKENLIST_PAGE_SIZE,
      offset,
    }),
    {
      signal,
    },
  )

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return normalizeTokenListResponse(await response.json())
}

async function fetchTokenList(url: string, chainId: string) {
  const tokenlist: TokenListItem[] = []
  let offset = 0
  const signal = AbortSignal.timeout(TOKENLIST_FETCH_TIMEOUT_MS)
  while (true) {
    const response = await fetchTokenListPage(url, chainId, offset, signal)
    tokenlist.push(...response.tokenlist)

    const total = response.meta?.total
    const pageOffset = response.meta?.offset ?? offset
    if (pageOffset !== offset) throw new Error("Invalid tokenlist page offset")
    if (
      total !== undefined &&
      response.tokenlist.length === 0 &&
      pageOffset < total
    ) {
      throw new Error("Incomplete tokenlist response")
    }
    if (
      total === undefined ||
      response.tokenlist.length === 0 ||
      pageOffset + response.tokenlist.length >= total
    ) {
      break
    }

    const nextOffset =
      pageOffset + (response.meta?.limit ?? response.tokenlist.length)
    if (nextOffset <= offset) throw new Error("Invalid tokenlist pagination")
    offset = nextOffset
  }

  for (const token of tokenlist) {
    if (token.logoURI) {
      token.logoURI = token.logoURI.replace(/([?&])v=[^&]*/g, "")
    }
  }
  return tokenlist
}

export function findTokenInCache(chainId: number, tokenAddress: Address) {
  return getTokenList(chainId).find((t: TokenListItem) =>
    isAddressEqual(t.address, tokenAddress),
  )
}

function upsertTokenInCache(token: TokenListItem) {
  let chainTokens = cache[token.chainId]
  if (!chainTokens) {
    chainTokens = []
    cache[token.chainId] = chainTokens
  }

  const existingIndex = chainTokens.findIndex((cachedToken) =>
    isAddressEqual(cachedToken.address, token.address),
  )

  if (existingIndex >= 0) {
    chainTokens[existingIndex] = { ...chainTokens[existingIndex], ...token }
    return chainTokens[existingIndex]
  }

  chainTokens.push(token)
  return token
}

function getPublicClient(chainId: number) {
  const rpcUrl = RPC_URLS[chainId]
  if (!rpcUrl) return

  return createPublicClient({
    transport: http(rpcUrl, { timeout: 120_000 }),
  }).extend(publicActions)
}

async function readStringMetadata(
  client: ReturnType<typeof getPublicClient>,
  tokenAddress: Address,
  functionName: "name" | "symbol",
) {
  if (!client) return

  try {
    return (await client.readContract({
      address: tokenAddress,
      abi: erc20StringAbi,
      functionName,
    })) as string
  } catch {
    try {
      const value = (await client.readContract({
        address: tokenAddress,
        abi: erc20Bytes32Abi,
        functionName,
      })) as `0x${string}`
      return hexToString(value, { size: 32 }).replace(/\0+$/g, "")
    } catch {
      return
    }
  }
}

async function fetchTokenFromContract(
  chainId: number,
  tokenAddress: Address,
): Promise<TokenListItem | undefined> {
  const client = getPublicClient(chainId)
  if (!client) return

  try {
    const [name, symbol, decimals] = await Promise.all([
      readStringMetadata(client, tokenAddress, "name"),
      readStringMetadata(client, tokenAddress, "symbol"),
      client.readContract({
        address: tokenAddress,
        abi: erc20DecimalsAbi,
        functionName: "decimals",
      }) as Promise<number>,
    ])

    if (!name || !symbol || decimals === undefined || decimals === null) return

    return upsertTokenInCache({
      address: tokenAddress,
      chainId,
      decimals,
      logoURI: "",
      name,
      symbol,
    })
  } catch {
    return
  }
}

export async function getOrFetchToken(
  chainId: number,
  tokenAddress: Address,
): Promise<TokenListItem | undefined> {
  const cachedToken = findTokenInCache(chainId, tokenAddress)
  if (cachedToken) return cachedToken

  const key = `${chainId}:${tokenAddress.toLowerCase()}`
  const pendingFetch = pendingTokenFetches.get(key)
  if (pendingFetch) return pendingFetch

  const fetchPromise = fetchTokenFromContract(chainId, tokenAddress).finally(
    () => {
      pendingTokenFetches.delete(key)
    },
  )

  pendingTokenFetches.set(key, fetchPromise)
  return fetchPromise
}

async function refreshTokenlists() {
  const tokenlistURL = process.env.TOKENLIST_URL
  if (!tokenlistURL) throw new Error("TOKENLIST_URL is required")

  const chainIds = Object.keys(RPC_URLS).filter(
    (chainId) => RPC_URLS[Number(chainId)],
  )
  if (!chainIds.length)
    throw new Error("At least one RPC_URL_<chainId> is required")

  await Promise.all(
    chainIds.map(async (chainId) => {
      const url = process.env[`TOKENLIST_URL_${chainId}`] || tokenlistURL
      try {
        const tokenlist = await fetchTokenList(url, chainId)
        if (!tokenlist.length)
          throw new Error(`Empty tokenlist for chain ${chainId}`)
        cache[Number(chainId)] = tokenlist
      } catch (err) {
        logWarn({
          name: `Error fetching tokenlist for chain ${chainId}`,
          error: err,
        })
        if (!cache[Number(chainId)]) {
          throw new Error(
            `Initial tokenlist load failed for chain ${chainId}`,
            { cause: err },
          )
        }
      }
    }),
  )
  mergeCustomTokens()
  return cache
}

let refreshPromise: Promise<typeof cache> | undefined

export function buildCache() {
  if (!refreshPromise) {
    refreshPromise = refreshTokenlists().finally(() => {
      refreshPromise = undefined
    })
  }
  return refreshPromise
}

export default function getTokenList(chainId: number): TokenListItem[] {
  return cache[chainId] || []
}

export function getAllTokenLists() {
  return cache
}

export async function initTokenlistCache() {
  await buildCache()
  return setInterval(
    () => {
      buildCache().catch((error) => {
        logWarn({ name: "Error refreshing tokenlists", error })
      })
    },
    Number(process.env.TOKENLIST_CACHE_TIMEOUT_SECONDS || 5 * 60) * 1000,
  )
}
