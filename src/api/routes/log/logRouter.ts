import express, { type Request, type Response, type Router } from "express"

import { ServiceResponse } from "@/common/models/serviceResponse"
import { handleServiceResponse } from "@/common/utils/httpHandlers"
import { logError, logProd, logWarn } from "@/common/utils/logs"

export const logRouter: Router = express.Router()

logRouter.post("", (req: Request, res: Response) => {
  const level =
    typeof req.body?.level === "string" ? req.body.level.toLowerCase() : ""
  const data = { name: "[LOG]", ...req.body }

  if (level === "error") {
    logError(data)
  } else if (level === "warn" || level === "warning") {
    logWarn(data)
  } else {
    logProd(data)
  }

  const serviceResponse = ServiceResponse.success({ msg: "success" })
  return handleServiceResponse(serviceResponse, res)
})
