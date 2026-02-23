import { env } from "./config/env.js"
import { nowIso } from "./utils/time.js"

type Level = "debug" | "info" | "warn" | "error"

type LogMeta = Record<string, unknown> | undefined

const write = (level: Level, message: string, meta?: LogMeta): void => {
  const payload = {
    ts: nowIso(),
    level,
    message,
    ...(meta ? { meta } : {}),
  }
  if (env.LOG_TO_CONSOLE) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload))
  }
}

export const logger = {
  debug: (message: string, meta?: LogMeta): void => write("debug", message, meta),
  info: (message: string, meta?: LogMeta): void => write("info", message, meta),
  warn: (message: string, meta?: LogMeta): void => write("warn", message, meta),
  error: (message: string, meta?: LogMeta): void => write("error", message, meta),
}
