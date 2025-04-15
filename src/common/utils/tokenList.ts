import fs from "node:fs"
import { type Address, isAddressEqual } from "viem"

export type TokenListItem = {
  addressInfo: Address
  chainId: number
  decimals: number
  logoURI: string
  name: string
  symbol: string
  meta?: {
    poolId?: string
    isPendlePT?: boolean
    pendleMarket?: string
  }
}

const cache: Record<number, TokenListItem[]> = {}
;(function buildCache() {
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

  if (
    !cache[1923].find((t) =>
      isAddressEqual(
        t.addressInfo,
        "0x9ab96A4668456896d45c301Bc3A15Cee76AA7B8D",
      ),
    )
  ) {
    // TODO add external tokens sources
    cache[1923].push({
      addressInfo: "0x9ab96A4668456896d45c301Bc3A15Cee76AA7B8D",
      chainId: 1923,
      name: "rUSDC",
      symbol: "rUSDC",
      decimals: 6,
      logoURI:
        "https://assets.coingecko.com/coins/images/55061/standard/rUSDC-_200x200.png?1743524727",
      meta: {},
    })
  }
})()

export default function getTokenList(chainId: number): TokenListItem[] {
  return cache[chainId] || []
}

export function getAllTokenLists() {
  return cache
}
