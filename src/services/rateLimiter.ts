import type { RateLimitState } from "../domain/types.js"

type HeaderState = {
  remaining: number | null
  resetAt: number | null
  blockedUntil: number
}

const toMillis = (seconds: number): number => Math.max(0, Math.round(seconds * 1000))

export class WebhookRateLimiter {
  private state = new Map<number, HeaderState>()

  public getBlockMs(webhookId: number): number {
    const entry = this.state.get(webhookId)
    if (!entry) {
      return 0
    }
    return Math.max(0, entry.blockedUntil - Date.now())
  }

  public markRateLimited(webhookId: number, retryAfterMs: number): void {
    const current = this.state.get(webhookId)
    const blockedUntil = Date.now() + Math.max(0, retryAfterMs)
    this.state.set(webhookId, {
      remaining: current?.remaining ?? null,
      resetAt: current?.resetAt ?? null,
      blockedUntil: Math.max(current?.blockedUntil ?? 0, blockedUntil),
    })
  }

  public updateFromResponse(webhookId: number, response: Response): void {
    const remainingHeader = response.headers.get("x-ratelimit-remaining")
    const resetAfterHeader = response.headers.get("x-ratelimit-reset-after")

    const remaining = remainingHeader !== null ? Number(remainingHeader) : null
    const resetAfterSec = resetAfterHeader !== null ? Number(resetAfterHeader) : null
    const resetMs = Number.isFinite(resetAfterSec) ? toMillis(Number(resetAfterSec)) : null
    const resetAt = resetMs !== null ? Date.now() + resetMs : null

    const existing = this.state.get(webhookId)
    let blockedUntil = existing?.blockedUntil ?? 0
    if (remaining !== null && remaining <= 0 && resetAt !== null) {
      blockedUntil = Math.max(blockedUntil, resetAt)
    }

    this.state.set(webhookId, { remaining, resetAt, blockedUntil })
  }

  public snapshot(): RateLimitState[] {
    return Array.from(this.state.entries()).map(([webhookId, value]) => ({
      webhookId,
      blockedUntil: value.blockedUntil,
      remaining: value.remaining,
      resetAt: value.resetAt,
    }))
  }
}
