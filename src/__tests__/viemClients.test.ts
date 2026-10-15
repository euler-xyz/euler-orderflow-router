import { afterEach, expect, it, vi } from "vitest"

const chainIds = [
  1, 56, 130, 143, 146, 239, 999, 8453, 9745, 42161, 43114, 59144, 60808, 80094,
]

afterEach(() => {
  vi.unstubAllEnvs()
})

it("creates a client with its own RPC for every supported chain", async () => {
  vi.resetModules()
  for (const chainId of chainIds) {
    vi.stubEnv(`RPC_URL_${chainId}`, `https://rpc-${chainId}.example`)
  }

  const { RPC_URLS, createClients, viemClients } = await import(
    "../common/utils/viemClients"
  )
  const clients = createClients()
  expect(Object.keys(RPC_URLS).map(Number)).toEqual(chainIds)
  expect(Object.keys(clients)).toEqual(Object.keys(RPC_URLS))
  expect(Object.keys(viemClients)).toEqual(Object.keys(RPC_URLS))

  for (const chainId of chainIds) {
    const url = `https://rpc-${chainId}.example`
    expect(RPC_URLS[chainId]).toBe(url)
    for (const client of [clients[chainId], viemClients[chainId]]) {
      expect(client.chain.id).toBe(chainId)
      expect(client.transport.url).toBe(url)
      expect(client.transport.timeout).toBe(120_000)
    }
  }
})

it("keeps clients registered when their RPC overrides are empty", async () => {
  vi.resetModules()
  for (const chainId of chainIds) vi.stubEnv(`RPC_URL_${chainId}`, "")

  const { RPC_URLS, viemClients } = await import("../common/utils/viemClients")
  for (const chainId of chainIds) {
    expect(RPC_URLS[chainId]).toBe("")
    expect(viemClients[chainId]?.chain.id).toBe(chainId)
    expect(viemClients[chainId].transport.url).toBe(
      viemClients[chainId].chain.rpcUrls.default.http[0],
    )
  }
})

it("uses independent RPC settings for Linea and BOB", async () => {
  vi.resetModules()
  vi.stubEnv("RPC_URL_56", "https://bsc.example")
  vi.stubEnv("RPC_URL_130", "https://unichain.example")
  vi.stubEnv("RPC_URL_59144", "")
  vi.stubEnv("RPC_URL_60808", "")
  vi.stubEnv("RPC_URL_1923", "")
  let config = await import("../common/utils/viemClients")
  expect(config.RPC_URLS[59144]).toBe("")
  expect(config.RPC_URLS[60808]).toBe("")
  expect(config.RPC_URLS[1923]).toBeUndefined()
  vi.resetModules()
  vi.stubEnv("RPC_URL_59144", "https://linea.example")
  vi.stubEnv("RPC_URL_60808", "https://bob.example")
  vi.stubEnv("RPC_URL_1923", "https://retired.example")
  config = await import("../common/utils/viemClients")
  expect(config.RPC_URLS[59144]).toBe("https://linea.example")
  expect(config.RPC_URLS[60808]).toBe("https://bob.example")
  expect(config.RPC_URLS[1923]).toBeUndefined()
  expect(config.viemClients[1923]).toBeUndefined()
})
