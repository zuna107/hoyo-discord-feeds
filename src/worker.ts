import { audit } from "./services/audit.js"
import { SchedulerService } from "./services/scheduler.js"

export const startWorker = (): SchedulerService => {
  const scheduler = new SchedulerService()
  scheduler.start()
  audit("info", "worker", "Worker started")
  return scheduler
}
