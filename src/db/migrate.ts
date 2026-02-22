import { db } from "./client.js"
import { logger } from "../logger.js"

try {
  db.pragma("optimize")
  logger.info("Database migration completed")
} finally {
  db.close()
}
