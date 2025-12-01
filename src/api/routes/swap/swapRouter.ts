import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"
import express, { type Router, type Request, type Response } from "express"

import { createApiResponse } from "@/api-docs/openAPIResponseBuilders"

import { ServiceResponse } from "@/common/models/serviceResponse"
import {
  handleServiceResponse,
  validateRequest,
} from "@/common/utils/httpHandlers"
import { log, logProd, logRouteTime } from "@/common/utils/logs"
import { findSwaps, reflectProviders } from "@/swapService/runner"
import type { SwapParams } from "@/swapService/types"
import {
  ApiError,
  findToken,
  getSwapper,
  parseHrtimeToSeconds,
} from "@/swapService/utils"
import { StatusCodes } from "http-status-codes"
import { InvalidAddressError } from "viem"
import { z } from "zod"
import {
  type ProvidersResponse,
  type SwapResponse,
  type SwapResponseSingle,
  getProvidersSchema,
  getSwapSchema,
  providersResponseSchema,
  swapResponseSchema,
  swapResponseSchemaSingle,
} from "./swapModel"

export const swapRegistry = new OpenAPIRegistry()
export const swapRouter: Router = express.Router()

swapRegistry.register("SwapQuote", swapResponseSchemaSingle)
swapRegistry.registerPath({
  method: "get",
  path: "/swap",
  tags: ["Get the best swap quote"],
  request: { query: getSwapSchema.shape.query },
  responses: createApiResponse(swapResponseSchemaSingle, "Success"),
})

swapRegistry.register("SwapQuotes", swapResponseSchema)
swapRegistry.registerPath({
  method: "get",
  path: "/swaps",
  tags: ["Get swap quotes ordered from best to worst"],
  request: { query: getSwapSchema.shape.query },
  responses: createApiResponse(swapResponseSchema, "Success"),
})

swapRegistry.register("Providers", providersResponseSchema)
swapRegistry.registerPath({
  method: "get",
  path: "/providers",
  tags: ["Get providers available for the queried chain"],
  request: { query: getProvidersSchema.shape.query },
  responses: createApiResponse(providersResponseSchema, "Success"),
})

swapRouter.get(
  "/providers",
  validateRequest(getProvidersSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        query: { chainId },
      } = getProvidersSchema.parse(req)
      const providers = await reflectProviders(chainId)

      return handleServiceResponse(
        ServiceResponse.success<ProvidersResponse>(providers),
        res,
      )
    } catch (error) {
      return handleServiceResponse(createFailureResponse(req, error), res)
    }
  },
)

swapRouter.get(
  "/swap",
  validateRequest(getSwapSchema),
  async (req: Request, res: Response) => {
    try {
      const swapParams = parseRequest(req)

      const startTime = process.hrtime()
      const swaps = await findSwaps(swapParams)
      const elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime))

      logRouteTime(swapParams, elapsedSeconds)

      return handleServiceResponse(
        ServiceResponse.success<SwapResponseSingle>(swaps[0]),
        res,
      )
    } catch (error) {
      return handleServiceResponse(createFailureResponse(req, error), res)
    } finally {
      log("===== SWAP END =====")
    }
  },
)

swapRouter.get(
  "/swaps",
  validateRequest(getSwapSchema),
  async (req: Request, res: Response) => {
    try {
      const swapParams = parseRequest(req)

      const startTime = process.hrtime()
      const swaps = await findSwaps(swapParams)
      const elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime))

      logRouteTime(swapParams, elapsedSeconds)

      return handleServiceResponse(
        ServiceResponse.success<SwapResponse>(swaps),
        res,
      )
    } catch (error) {
      return handleServiceResponse(createFailureResponse(req, error), res)
    } finally {
      log("===== SWAPS END =====")
    }
  },
)

function createFailureResponse(req: Request, error: any) {
  logProd({
    name: "[ERROR]",
    statusCode: error.statusCode,
    message: error.message,
    errorMessage: error.errorMessage,
    data: error.data,
    url: req.url,
  })
  if (error instanceof ApiError) {
    return ServiceResponse.failure(error.message, error.statusCode, error.data)
  }
  return ServiceResponse.failure(`${error}`, StatusCodes.INTERNAL_SERVER_ERROR)
}

function parseRequest(request: Request): SwapParams {
  try {
    logProd({
      name: "INCOMING QUERY",
      request: request.query,
    })

    const { query: validatedParams } = getSwapSchema.parse(request)

    // TODO
    // if (!isSupportedChainId(validatedParams.chainId)) {
    //   throw new Error("Unsupported chainId")
    //  }

    const chainId = validatedParams.chainId
    const tokenIn = findToken(chainId, validatedParams.tokenIn)
    if (!tokenIn)
      throw new ApiError(StatusCodes.NOT_FOUND, "Token in not supported")

    const tokenOut = findToken(chainId, validatedParams.tokenOut)

    if (!tokenOut)
      throw new ApiError(StatusCodes.NOT_FOUND, "Token out not supported")

    return {
      ...validatedParams,
      dustAccount: validatedParams.dustAccount || validatedParams.accountOut,
      from: getSwapper(chainId),
      chainId,
      tokenIn,
      tokenOut,
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof z.ZodError) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(", ")}`,
      )
    }
    if (error instanceof InvalidAddressError)
      throw new ApiError(400, "Invalid Address")

    throw new ApiError(500, `${error}`)
  }
}
