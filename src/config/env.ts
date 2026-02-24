import dotenv from "dotenv"
import { z } from "zod"
import { HOYOLAB_LANGUAGES } from "../domain/hoyolabLanguages.js"

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  ROLE: z.enum(["all", "api", "worker"]).default("all"),
  LOG_TO_CONSOLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DB_PATH: z.string().min(1).default("./data/feed-engine.db"),
  CORS_ORIGIN: z.string().default("*"),
  DASHBOARD_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DASHBOARD_SETUP_KEY: z.string().optional(),
  DASHBOARD_AUTH_ISSUER: z.string().default("Hoyo Feed Engine"),
  DASHBOARD_AUTH_ACCOUNT: z.string().default("dashboard-admin"),
  DASHBOARD_SESSION_SECRET: z.string().default("change-me-dashboard-session-secret"),
  DASHBOARD_SESSION_TTL_HOURS: z.coerce.number().positive().default(24),
  SCHEDULER_TICK_CRON: z.string().min(1).default("*/30 * * * * *"),
  DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  DISPATCH_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MAX_POST_AGE_HOURS: z.coerce.number().min(0).default(24),
  SUBSCRIPTION_BACKFILL_COUNT: z.coerce.number().int().min(0).default(1),
  MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(6),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(5000),
  TWITTER_BEARER_TOKEN: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_API_FALLBACK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  HOYOLAB_ENDPOINT: z.string().optional(),
  HOYOLAB_LANGUAGE: z.enum(HOYOLAB_LANGUAGES).default("en-us"),
  HOYOLAB_APP_VERSION: z.string().default("3.9.0"),
  FALLBACK_SCRAPING_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
})

export const env = envSchema.parse(process.env)
