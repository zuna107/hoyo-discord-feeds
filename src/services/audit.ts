import { logRepo } from "../db/repositories.js"
import { logger } from "../logger.js"

type Level = "debug" | "info" | "warn" | "error"

export const audit = (level: Level, component: string, message: string, meta?: Record<string, unknown>): void => {
  logger[level](`[${component}] ${message}`, meta)
  logRepo.write(level, component, message, meta)
}
