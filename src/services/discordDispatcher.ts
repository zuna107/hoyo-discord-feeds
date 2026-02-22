import pLimit from "p-limit"
import { env } from "../config/env.js"
import { deliveryRepo } from "../db/repositories.js"
import type { NormalizedPost } from "../domain/types.js"
import { isoAfterMs, nowIso } from "../utils/time.js"
import { audit } from "./audit.js"
import { WebhookRateLimiter } from "./rateLimiter.js"
import { buildRetryPlan } from "./retryPolicy.js"

type DueDelivery = ReturnType<typeof deliveryRepo.listDue>[number]

const HOYOLAB_EMBED_COLOR = 7423719

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 3)}...` : value

const toFxTwitterUrl = (post: NormalizedPost): string => {
  const idFromUrl = post.url.match(/status\/(\d+)/)?.[1]
  const id = idFromUrl ?? post.externalPostId
  return `https://fxtwitter.com/i/status/${id}`
}

const buildHoyolabDescription = (post: NormalizedPost): string => {
  const content = post.text.trim().length > 0 ? post.text.trim() : "No description."
  const normalized = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp/g, " ")
    .replace(/&amp/g, "&")
    .replace(/&lt/g, "<")
    .replace(/&gt/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const clipped = truncate(normalized, 3700)
  return `${clipped}\n\n[Read more...](${post.url})`
}

const isStalePostForDispatch = (post: NormalizedPost): boolean => {
  if (env.MAX_POST_AGE_HOURS <= 0) {
    return false
  }
  const publishedMs = new Date(post.publishedAt).getTime()
  if (!Number.isFinite(publishedMs)) {
    return true
  }
  return Date.now() - publishedMs > env.MAX_POST_AGE_HOURS * 60 * 60 * 1000
}

const buildDiscordBody = (post: NormalizedPost): Record<string, unknown> => {
  if (post.source === "twitter") {
    return {
      content: toFxTwitterUrl(post),
      allowed_mentions: { parse: [] },
    }
  }

  if (post.source === "youtube") {
    return {
      content: post.url,
      allowed_mentions: { parse: [] },
    }
  }

  const firstImage = post.media.find((media) => media.type === "image")

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        author: {
          name: post.authorName,
          ...(post.authorUrl ? { url: post.authorUrl } : {}),
          ...(post.authorIconUrl ? { icon_url: post.authorIconUrl } : {}),
        },
        title: truncate(post.title || "New Post", 256),
        description: buildHoyolabDescription(post),
        url: post.url,
        color: HOYOLAB_EMBED_COLOR,
        timestamp: post.publishedAt,
        footer: { text: "HoYoLAB" },
        ...(firstImage ? { image: { url: firstImage.url } } : {}),
      },
    ],
  }
}

const parseRetryAfterMs = async (response: Response): Promise<number> => {
  const header = response.headers.get("retry-after")
  if (header) {
    const sec = Number(header)
    if (Number.isFinite(sec)) {
      return Math.max(0, Math.round(sec * 1000))
    }
  }
  try {
    const body = (await response.clone().json()) as { retry_after?: number }
    if (typeof body.retry_after === "number" && Number.isFinite(body.retry_after)) {
      return Math.max(0, Math.round(body.retry_after * 1000))
    }
  } catch {
    // Ignore parse failure and fall back to default.
  }
  return 30000
}

export class DiscordDispatcher {
  private limiter = new WebhookRateLimiter()

  public getRateLimitSnapshot(): ReturnType<WebhookRateLimiter["snapshot"]> {
    return this.limiter.snapshot()
  }

  public async dispatchDueBatch(): Promise<number> {
    const due = deliveryRepo.listDue(env.DISPATCH_BATCH_SIZE, nowIso())
    if (due.length === 0) {
      return 0
    }
    const limit = pLimit(env.DISPATCH_CONCURRENCY)
    await Promise.all(due.map((row) => limit(async () => this.dispatchOne(row))))
    return due.length
  }

  private async dispatchOne(delivery: DueDelivery): Promise<void> {
    const localBlockMs = this.limiter.getBlockMs(delivery.webhookId)
    if (localBlockMs > 0) {
      deliveryRepo.markRetry(
        delivery.id,
        isoAfterMs(localBlockMs),
        delivery.attempt,
        "Local webhook throttle gate",
        429
      )
      return
    }

    let post: NormalizedPost
    try {
      post = JSON.parse(delivery.payloadJson) as NormalizedPost
    } catch {
      deliveryRepo.markDead(delivery.id, delivery.attempt + 1, "Invalid payload json", null)
      audit("error", "dispatch", "Payload parse failed", { deliveryId: delivery.id })
      return
    }

    if (isStalePostForDispatch(post)) {
      deliveryRepo.markDead(
        delivery.id,
        delivery.attempt + 1,
        `Skipped by age policy (${env.MAX_POST_AGE_HOURS}h)`,
        null
      )
      audit("info", "dispatch", "Skipped stale delivery", {
        deliveryId: delivery.id,
        source: post.source,
        publishedAt: post.publishedAt,
      })
      return
    }

    try {
      const response = await fetch(delivery.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildDiscordBody(post)),
      })
      this.limiter.updateFromResponse(delivery.webhookId, response)

      if (response.ok) {
        deliveryRepo.markSent(delivery.id, response.status)
        return
      }

      const status = response.status
      const attempt = delivery.attempt + 1
      const retryAfterMs = status === 429 ? await parseRetryAfterMs(response) : null
      if (retryAfterMs !== null) {
        this.limiter.markRateLimited(delivery.webhookId, retryAfterMs)
      }
      const plan = buildRetryPlan(attempt, status, retryAfterMs)

      if (plan.shouldRetry) {
        deliveryRepo.markRetry(delivery.id, plan.nextRetryAtIso, attempt, `HTTP ${status}`, status)
        return
      }

      deliveryRepo.markDead(delivery.id, attempt, `HTTP ${status}`, status)
      audit("error", "dispatch", "Delivery moved to dead state", {
        deliveryId: delivery.id,
        status,
      })
    } catch (error) {
      const attempt = delivery.attempt + 1
      const message = error instanceof Error ? error.message : "Network error"
      const plan = buildRetryPlan(attempt, null, null)
      if (plan.shouldRetry) {
        deliveryRepo.markRetry(delivery.id, plan.nextRetryAtIso, attempt, message, null)
        return
      }
      deliveryRepo.markDead(delivery.id, attempt, message, null)
    }
  }
}
