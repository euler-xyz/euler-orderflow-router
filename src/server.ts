import cors from "cors"
import express, { type Express } from "express"
import helmet from "helmet"
import { pino } from "pino"

import { openAPIRouter } from "@/api-docs/openAPIRouter"
import { healthCheckRouter } from "@/api/routes/healthCheck/healthCheckRouter"
import { logRouter } from "@/api/routes/log/logRouter"
import { swapRouter } from "@/api/routes/swap/swapRouter"
import errorHandler from "@/common/middleware/errorHandler"
import rateLimiter from "@/common/middleware/rateLimiter"
import requestLogger from "@/common/middleware/requestLogger"

const logger = pino({ name: "server start" })
const app: Express = express()

// Set the application to trust the reverse proxy
// app.set("trust proxy", true);

// Middlewares
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }))
app.use(helmet())
app.use(rateLimiter)

// Request logging
app.use(requestLogger)

// Routes
app.use("/log", logRouter)
app.use("/health-check", healthCheckRouter)
app.use(swapRouter)

// Swagger UI
app.use(openAPIRouter)

// Error handlers
app.use(errorHandler())

export { app, logger }
