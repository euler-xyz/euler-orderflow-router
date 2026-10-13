import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
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
})
