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
  meta?: {
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
;(function buildCache() {
  const tokenlistURL = process.env.TOKENLIST_URL
  if (!tokenlistURL) {
    console.warn(
      "Missing TOKENLIST_URL configuration. Falling back to static files",
    )
    loadTokenlistsFromFiles()
    return
  }

  Promise.all(
    Object.keys(RPC_URLS).map(async (chainId) => {
      const response = await fetch(`${tokenlistURL}?chainId=${chainId}`)
      if (!response.ok) {
        throw new Error(`Failed fetching tokenlist for chain ${chainId}`)
      }
      cache[Number(chainId)] = (await response.json()) as TokenListItem[]
    }),
  )
})()

export default function getTokenList(chainId: number): TokenListItem[] {
  return cache[chainId] || []
}

export function getAllTokenLists() {
  return cache
}
