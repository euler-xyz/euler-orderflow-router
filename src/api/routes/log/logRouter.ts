import express, { type Request, type Response, type Router } from "express"

import { ServiceResponse } from "@/common/models/serviceResponse"
import { handleServiceResponse } from "@/common/utils/httpHandlers"
import { logProd } from "@/common/utils/logs"
import { logger } from "ethers"

export const logRouter: Router = express.Router()

logRouter.post("", (req: Request, res: Response) => {
  logProd({ name: "[LOG]", ...req.body })

  const serviceResponse = ServiceResponse.success({ msg: "success" })
  return handleServiceResponse(serviceResponse, res)
})
