import fs from "node:fs"
import type { Address } from "viem"
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

const loadTokenlistsFromFiles = () => {
  let dir = `${__dirname}/../tokenLists`
  let files
  try {
    files = fs.readdirSync(dir)
  } catch {
    dir = `${__dirname}/../../../tokenLists`
    files = fs.readdirSync(dir)
  }
  for (const file of files) {
    const match = file.match(/(\d+)/g)
    if (!match) throw new Error("Invalid tokenlist file")
    const chainId = Number(match[0])
    cache[chainId] = JSON.parse(
      fs.readFileSync(`${dir}/${file}`).toString(),
    ) as TokenListItem[]
  }
}

const writeTokenListsToFiles = () => {
  let dir = `${__dirname}/../tokenLists`
  try {
    fs.readdirSync(dir)
  } catch {
    dir = `${__dirname}/../../../tokenLists`
  }
  for (const [chainId, tokenlist] of Object.entries(cache)) {
    fs.writeFileSync(
      `${dir}/tokenList_${chainId}.json`,
      JSON.stringify(tokenlist, null, 2),
    )
  }
}

export async function buildCache() {
  const tokenlistURL = process.env.TOKENLIST_URL
  if (!tokenlistURL) {
    console.warn(
      "Missing TOKENLIST_URL configuration. Falling back to static files",
    )
    loadTokenlistsFromFiles()
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

      // TODO REMOVE
      if (chainId === "130") {
        const cusd = cache[Number(chainId)].find(
          (t) => t.address === "0xB6168F597Cd37A232cb7CB94CD1786Be20eAD156",
        )
        if (cusd) {
          cusd.metadata = {
            isPendleCrossChainPT: true,
            pendleCrossChainPTPaired:
              "0x078d782b760474a361dda0af3839290b0ef57ad6",
          }
        }
      }
    }),
  ).catch((err) => {
    console.log(`Error fetching tokenlists ${err}`)
    loadTokenlistsFromFiles()
  })

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
