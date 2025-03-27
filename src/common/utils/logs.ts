import { SwapperMode } from "@/swapService/interface"
import type { SwapParams } from "@/swapService/types"
import type { SourceListQuoteRequest } from "@balmy/sdk"
import httpContext from "express-http-context"
import pino from "pino"

export const logger = pino({
  name: "server start",
  formatters: {
    bindings: (_) => ({}),
  },
})

export const logEnv = (
  env: "all" | "production" | "development",
  data: object,
) => {
  if (typeof data === "string") {
    if (process.env.NODE_ENV === "development") {
      logger.info(data)
      return
    }
    data = { name: data }
  }

  if (env === process.env.NODE_ENV || env === "all") {
    logger.info({
      ip: httpContext.get("remoteIP"),
      ...data,
    })
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

export const logRouteTime = (
  swapParams: SwapParams,
  elapsedSeconds: number,
) => {
  logProd({
    name: "ROUTE EXECUTED",
    swapperMode: swapParams.swapperMode,
    elapsedSeconds,
  })
  if (elapsedSeconds > 10) {
    logProd({
      name: "SLOW ROUTE [10]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 5) {
    logProd({
      name: "SLOW ROUTE [5]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 3) {
    logProd({
      name: "SLOW ROUTE [3]",
      swapperMode: swapParams.swapperMode,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 1) {
    logProd({
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

  logProd({
    name: "QUOTE EXECUTED",
    sourceId,
    request: requestGist,
    elapsedSeconds,
  })

  if (elapsedSeconds > 10) {
    logProd({
      name: "SLOW QUOTE [10]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 5) {
    logProd({
      name: "SLOW QUOTE [5]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 3) {
    logProd({
      name: "SLOW QUOTE [3]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  } else if (elapsedSeconds > 1) {
    logProd({
      name: "SLOW QUOTE [1]",
      sourceId,
      request: requestGist,
      elapsedSeconds,
    })
  }
}
