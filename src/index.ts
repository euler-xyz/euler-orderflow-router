import { app, logger } from "@/server"
import {
  initContractBookCache,
  loadDeployments,
} from "./common/utils/deployments"
import { initTokenlistCache } from "./common/utils/tokenList"

async function main() {
  await loadDeployments().catch((error) => {
    logger.warn(
      { err: error },
      "Failed to refresh contractBook addresses on startup",
    )
  })

  const tokenlistRefreshTimer = await initTokenlistCache()
  const contractBookRefreshTimer = initContractBookCache()

  const server = app.listen(process.env.PORT, () => {
    const { NODE_ENV, PORT } = process.env
    logger.info(`Server (${NODE_ENV}) running on port http://localhost:${PORT}`)
  })

  const onCloseSignal = () => {
    logger.info("sigint received, shutting down")
    clearInterval(tokenlistRefreshTimer)
    clearInterval(contractBookRefreshTimer)
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
  logger.error({ err: error }, "Server startup failed")
  process.exit(1)
})
