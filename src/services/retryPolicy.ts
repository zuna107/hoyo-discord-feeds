import { env } from "../config/env.js"
import type { RetryPlan } from "../domain/types.js"
import { isoAfterMs } from "../utils/time.js"

const clientRetryable = new Set([408, 425, 429])

const isRetryableStatus = (status: number | null): boolean => {
  if (status === null) {
    return true
  }
  if (clientRetryable.has(status)) {
    return true
  }
  return status >= 500
}

export const buildRetryPlan = (
  attempt: number,
  statusCode: number | null,
  retryAfterMs: number | null
): RetryPlan => {
  if (!isRetryableStatus(statusCode)) {
    return {
      status: "dead",
      shouldRetry: false,
      nextRetryAtIso: isoAfterMs(0),
    }
  }

  if (attempt >= env.MAX_RETRY_ATTEMPTS) {
    return {
      status: "dead",
      shouldRetry: false,
      nextRetryAtIso: isoAfterMs(0),
    }
  }

  const exponentialMs = env.RETRY_BASE_MS * Math.pow(3, Math.max(0, attempt - 1))
  const delayMs = Math.max(exponentialMs, retryAfterMs ?? 0)

  return {
    status: "retry",
    shouldRetry: true,
    nextRetryAtIso: isoAfterMs(delayMs),
  }
}
