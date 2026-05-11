import type { SwapParams } from "@/swapService/types"
import type { SourceListQuoteRequest } from "@balmy/sdk"
import httpContext from "express-http-context"
import pino from "pino"

const WARN_LEVEL = 40

export const isProductionEnv = () => {
  const isProduction = process.env.isProduction?.toLowerCase()
  return (
    process.env.NODE_ENV === "production" ||
    isProduction === "true" ||
    isProduction === "1"
  )
}

export const logger = pino({
  name: "server start",
  level: isProductionEnv() ? "warn" : process.env.LOG_LEVEL || "info",
  formatters: {
    bindings: (_) => ({}),
  },
  hooks: {
    logMethod(args, method, level) {
      if (isProductionEnv() && level < WARN_LEVEL) return
      method.apply(this, args)
    },
  },
})

const withRequestContext = (data: object | string) => {
  const payload = typeof data === "string" ? { name: data } : data
  return {
    ip: httpContext.get("remoteIP"),
    ...payload,
  }
}

export const logEnv = (
  env: "all" | "production" | "development",
  data: object | string,
) => {
  if (isProductionEnv()) return

  if (typeof data === "string") {
    if (process.env.NODE_ENV === "development") {
      logger.info(data)
      return
    }
    data = { name: data }
  }

  if (env === process.env.NODE_ENV || env === "all") {
    logger.info(withRequestContext(data))
  }
}

export const log = (data: any) => {
  logEnv("all", data)
}

export const logDev = (data: any) => {
  logEnv("development", data)
}

export const logProd = (data: any) => {
  logEnv("production", data)
}

export const logWarn = (data: object | string) => {
  logger.warn(withRequestContext(data))
}

export const logError = (data: object | string) => {
  logger.error(withRequestContext(data))
}

export const logRouteTime = (
  swapParams: SwapParams,
  elapsedSeconds: number,
) => {
  logDev({
    name: "ROUTE EXECUTED",
    swapperMode: swapParams.swapperMode,
    elapsedSeconds,
  })
  if (elapsedSeconds > 10) {
    logWarn({
      name: "SLOW ROUTE [10]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 5) {
    logWarn({
      name: "SLOW ROUTE [5]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 3) {
    logWarn({
      name: "SLOW ROUTE [3]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 1) {
    logWarn({
      name: "SLOW ROUTE [1]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  }
}

export const logQuoteTime = (
  request: SourceListQuoteRequest,
  sourceId: string,
  elapsedSeconds: number,
) => {
  const { chainId, sellToken, buyToken, order } = request
  const requestGist = {
    chainId,
    sellToken,
    buyToken,
    order,
  }

  logDev({
    name: "QUOTE EXECUTED",
    sourceId,
    request: requestGist,
    elapsedSeconds,
  })

  if (elapsedSeconds > 10) {
    logWarn({
      name: "SLOW QUOTE [10]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 5) {
    logWarn({
      name: "SLOW QUOTE [5]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 3) {
    logWarn({
      name: "SLOW QUOTE [3]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 1) {
    logWarn({
      name: "SLOW QUOTE [1]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  }
}
