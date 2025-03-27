import cors from "cors"
import express, { type Express } from "express"
import httpContext from "express-http-context"
import helmet from "helmet"

import { openAPIRouter } from "@/api-docs/openAPIRouter"
import { healthCheckRouter } from "@/api/routes/healthCheck/healthCheckRouter"
import { logRouter } from "@/api/routes/log/logRouter"
import { swapRouter } from "@/api/routes/swap/swapRouter"
import errorHandler from "@/common/middleware/errorHandler"
import rateLimiter from "@/common/middleware/rateLimiter"
import { logger } from "./common/utils/logs"
// import requestLogger from "@/common/middleware/requestLogger"

const app: Express = express()

// Set the application to trust the reverse proxy
// app.set("trust proxy", true);

// Middlewares
app.use(express.json({ limit: "5mb" }))
app.use(express.urlencoded({ extended: true, limit: "5mb" }))
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }))
app.use(helmet())
app.use(rateLimiter)
app.use(httpContext.middleware)
app.use((req, _, next) => {
  httpContext.set(
    "remoteIP",
    req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  )
  next()
})
// Request logging
// app.use(requestLogger)

// Routes
app.use("/log", logRouter)
app.use("/health-check", healthCheckRouter)
app.use(swapRouter)

// Swagger UI
app.use(openAPIRouter)

// Error handlers
app.use(errorHandler())

export { app, logger }
