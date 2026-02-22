import { env } from "./config/env.js"
import { buildApiServer } from "./api/server.js"
import { audit } from "./services/audit.js"
import { SchedulerService } from "./services/scheduler.js"

const scheduler = new SchedulerService()
const shouldStartApi = env.ROLE === "all" || env.ROLE === "api"
const shouldStartWorker = env.ROLE === "all" || env.ROLE === "worker"

const bootstrap = async (): Promise<void> => {
  if (shouldStartWorker) {
    scheduler.start()
  }

  if (shouldStartApi) {
    const app = buildApiServer(scheduler)
    await app.listen({ host: "0.0.0.0", port: env.PORT })
    audit("info", "api", "API server started", { port: env.PORT, role: env.ROLE })

    const shutdown = async (): Promise<void> => {
      scheduler.stop()
      await app.close()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
    return
  }

  if (!shouldStartApi && shouldStartWorker) {
    process.on("SIGINT", () => {
      scheduler.stop()
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      scheduler.stop()
      process.exit(0)
    })
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error"
  audit("error", "bootstrap", message)
  process.exit(1)
})
