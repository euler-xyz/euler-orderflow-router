import express, { type Request, type Response, type Router } from "express"

import { ServiceResponse } from "@/common/models/serviceResponse"
import { handleServiceResponse } from "@/common/utils/httpHandlers"

export const logRouter: Router = express.Router()

logRouter.post("", (req: Request, res: Response) => {
  console.log("[LOG]", JSON.stringify(req.body))

  const serviceResponse = ServiceResponse.success({ msg: "success" })
  return handleServiceResponse(serviceResponse, res)
})
