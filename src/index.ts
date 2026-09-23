import { app, logger } from "@/server"
import { loadDeployments } from "./common/utils/deployments"
import { initTokenlistCache } from "./common/utils/tokenList"

async function main() {
  await loadDeployments()

  initTokenlistCache()

  const server = app.listen(process.env.PORT, () => {
    const { NODE_ENV, PORT } = process.env
    logger.info(`Server (${NODE_ENV}) running on port http://localhost:${PORT}`)
  })

  const onCloseSignal = () => {
    logger.info("sigint received, shutting down")
    server.close(() => {
      logger.info("server closed")
      process.exit()
    })
    setTimeout(() => process.exit(1), 10000).unref() // Force shutdown after 10s
  }

  process.on("SIGINT", onCloseSignal)
  process.on("SIGTERM", onCloseSignal)
}

void main().catch((error) => {
  logger.error({ error }, "Fatal: failed to load deployments on startup")
  process.exit(1)
})
