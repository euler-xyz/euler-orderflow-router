import fs from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TokenListItem } from "../common/utils/tokenList"

vi.mock("node:fs", () => ({
  default: {
    readdirSync: vi.fn(() => ["tokenList_1.json"]),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))
vi.mock("../common/utils/viemClients", () => ({ RPC_URLS: { 1: "" } }))
vi.mock("../common/utils/logs", () => ({ logWarn: vi.fn() }))

const imageAddress = "0xd9Fcd98c322942075A5C3860693e9f4f03AAE07b"
const legacyImage = `https://token-images.euler.finance/1/${imageAddress}`
const v3Image = `https://v3.euler.finance/v3/images/tokens/1/${imageAddress}`
const staticToken: TokenListItem = {
  address: "0x0000000000000000000000000000000000000001",
  chainId: 1,
  decimals: 6,
  logoURI: legacyImage,
  name: "Test token",
  symbol: "TEST",
  metadata: { isPendlePT: true, pendleMarket: "market" },
}
const customToken: TokenListItem = {
  ...staticToken,
  address: "0x0000000000000000000000000000000000000002",
  name: "Custom token",
}
let tokenList: typeof import("../common/utils/tokenList")
const fetchMock = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv("TOKENLIST_URL", "")
  vi.stubGlobal("fetch", fetchMock)
  vi.mocked(fs.readFileSync).mockImplementation((path) =>
    Buffer.from(
      JSON.stringify([
        String(path).endsWith("custom.json") ? customToken : staticToken,
      ]),
    ),
  )
  tokenList = await import("../common/utils/tokenList")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("token image URLs", () => {
  it.each([
    [legacyImage, v3Image],
    [legacyImage.replace("https:", "http:"), v3Image],
    [
      legacyImage.replace(
        "token-images.euler.finance",
        "TOKEN-IMAGES.EULER.FINANCE",
      ),
      v3Image,
    ],
    [`${legacyImage}?v=10&size=32#logo`, `${v3Image}?v=10&size=32#logo`],
    [v3Image, v3Image],
    ["", ""],
    ["ipfs://example", "ipfs://example"],
    ["not a URL", "not a URL"],
    [
      "https://token-images.euler.finance/labels/kpk",
      "https://token-images.euler.finance/labels/kpk",
    ],
    [
      "https://token-images.euler.finance/unknown",
      "https://token-images.euler.finance/unknown",
    ],
    [
      "https://token-images.euler.finance/1/0x123",
      "https://token-images.euler.finance/1/0x123",
    ],
    [`${legacyImage}/extra`, `${legacyImage}/extra`],
    [
      `https://other.example/${legacyImage}`,
      `https://other.example/${legacyImage}`,
    ],
    [
      "https://token-images.euler.finance.example/1/logo",
      "https://token-images.euler.finance.example/1/logo",
    ],
    [
      "https://token-images.euler.finance@other.example/1/logo",
      "https://token-images.euler.finance@other.example/1/logo",
    ],
  ])("normalizes %s without changing its image identity", (input, expected) => {
    expect(tokenList.normalizeTokenImageURL(input)).toBe(expected)
  })
})

describe("token list image normalization", () => {
  it("normalizes static and custom fallback images without changing metadata", async () => {
    const cache = await tokenList.buildCache()

    expect(cache[1]).toEqual([
      { ...staticToken, logoURI: v3Image },
      { ...customToken, logoURI: v3Image },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it("normalizes and persists static fallback images when the upstream fails", async () => {
    vi.stubEnv("TOKENLIST_URL", "https://v3.euler.finance/v3/tokens")
    fetchMock.mockRejectedValueOnce(new Error("upstream unavailable"))

    const cache = await tokenList.buildCache()

    expect(cache[1][0]).toEqual({ ...staticToken, logoURI: v3Image })
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("tokenList_1.json"),
      JSON.stringify(cache[1], null, 2),
    )
    expect(JSON.stringify(cache)).not.toContain("token-images.euler.finance")
  })

  it("normalizes all V3 pages from a per-chain override before caching and writing", async () => {
    vi.stubEnv("TOKENLIST_URL", "https://v3.euler.finance/v3/tokens")
    vi.stubEnv(
      "TOKENLIST_URL_1",
      "https://override.example/tokens?source=custom",
    )
    const secondToken = {
      ...staticToken,
      address: customToken.address,
      logoURI: v3Image,
    }
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ ...staticToken, logoURI: `${legacyImage}?v=10` }],
          meta: { total: 2, offset: 0, limit: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [secondToken],
          meta: { total: 2, offset: 1, limit: 1 },
        }),
      })

    const cache = await tokenList.buildCache()

    expect(cache[1]).toEqual([
      { ...staticToken, logoURI: v3Image },
      secondToken,
    ])
    const requests = fetchMock.mock.calls.map(([url]) => new URL(url))
    expect(requests.map((url) => url.searchParams.get("offset"))).toEqual([
      "0",
      "1",
    ])
    expect(requests.every((url) => url.hostname === "override.example")).toBe(
      true,
    )
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("tokenList_1.json"),
      JSON.stringify(cache[1], null, 2),
    )
  })

  it("normalizes legacy array responses before caching and writing", async () => {
    vi.stubEnv("TOKENLIST_URL", "https://override.example/tokens")
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ...staticToken }],
    })

    const cache = await tokenList.buildCache()

    expect(cache[1][0]).toEqual({ ...staticToken, logoURI: v3Image })
    expect(JSON.stringify(cache)).not.toContain("token-images.euler.finance")
  })
})
