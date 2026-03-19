import fs from "node:fs"
import {
  http,
  type Address,
  createPublicClient,
  hexToString,
  isAddressEqual,
  parseAbi,
  publicActions,
} from "viem"
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

const erc20StringAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
])
const erc20Bytes32Abi = parseAbi([
  "function name() view returns (bytes32)",
  "function symbol() view returns (bytes32)",
])
const erc20DecimalsAbi = parseAbi(["function decimals() view returns (uint8)"])

const getTokenListsDir = () => {
  let dir = `${__dirname}/../tokenLists`
  try {
    fs.readdirSync(dir)
  } catch {
    dir = `${__dirname}/../../../tokenLists`
  }
  return dir
}

const mergeCustomTokens = () => {
  const dir = getTokenListsDir()
  const customPath = `${dir}/custom.json`
  if (!fs.existsSync(customPath)) return

  const customTokens = JSON.parse(
    fs.readFileSync(customPath).toString(),
  ) as TokenListItem[]

  for (const token of customTokens) {
    let chainTokens = cache[token.chainId]
    if (!chainTokens) {
      chainTokens = []
      cache[token.chainId] = chainTokens
    }
    const exists = chainTokens.some(
      (cachedToken) =>
        cachedToken.address.toLowerCase() === token.address.toLowerCase(),
    )
    if (!exists) chainTokens.push(token)
  }
}

const loadTokenlistsFromFiles = () => {
  const dir = getTokenListsDir()
  const files = fs
    .readdirSync(dir)
    .filter((file) => /^tokenList_(\d+)\.json$/.test(file))
  for (const file of files) {
    const match = file.match(/^tokenList_(\d+)\.json$/)
    if (!match) throw new Error("Invalid tokenlist file")
    const chainId = Number(match[1])
    cache[chainId] = JSON.parse(
      fs.readFileSync(`${dir}/${file}`).toString(),
    ) as TokenListItem[]
  }
}

const writeTokenListsToFiles = () => {
  const dir = getTokenListsDir()
  for (const [chainId, tokenlist] of Object.entries(cache)) {
    fs.writeFileSync(
      `${dir}/tokenList_${chainId}.json`,
      JSON.stringify(tokenlist, null, 2),
    )
  }
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

export async function buildCache() {
  const tokenlistURL = process.env.TOKENLIST_URL
  if (!tokenlistURL) {
    console.warn(
      "Missing TOKENLIST_URL configuration. Falling back to static files",
    )
    loadTokenlistsFromFiles()
    mergeCustomTokens()
    return cache
  }

  await Promise.all(
    Object.keys(RPC_URLS).map(async (chainId) => {
      let url = tokenlistURL
      if (chainId === "80094") {
        url = "https://indexer-main-erpc.euler.finance/v1/tokens"
      }
      const response = await fetch(`${url}?chainId=${chainId}`)

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const res = await response.json()
      if (res.success === "false") {
        throw new Error(JSON.stringify(res))
      }
      for (const t of res) {
        t.logoURI = t.logoURI.replace(/([?&])v=[^&]*/g, "")
      }
      cache[Number(chainId)] = res as TokenListItem[]
    }),
  ).catch((err) => {
    console.log(`Error fetching tokenlists ${err}`)
    loadTokenlistsFromFiles()
  })
  mergeCustomTokens()

  try {
    writeTokenListsToFiles()
  } catch (err) {
    console.log(`Error writing tokenlists, ${err}`)
  }
  return cache
}

export default function getTokenList(chainId: number): TokenListItem[] {
  return cache[chainId] || []
}

export function getAllTokenLists() {
  return cache
}

export function initTokenlistCache() {
  buildCache()
  setInterval(
    buildCache,
    Number(process.env.TOKENLIST_CACHE_TIMEOUT_SECONDS || 5 * 60) * 1000,
  )
}
