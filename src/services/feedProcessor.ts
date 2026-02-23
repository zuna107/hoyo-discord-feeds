import { getAdapter } from "../adapters/index.js"
import { env } from "../config/env.js"
import { deliveryRepo, eventRepo, feedRepo } from "../db/repositories.js"
import type { Feed, NormalizedPost } from "../domain/types.js"
import { isoAfterMs, nowIso } from "../utils/time.js"
import { audit } from "./audit.js"
import { UpstreamRateLimitError, UpstreamTemporaryError } from "./errors.js"

const defaultCooldownMs = 15 * 60 * 1000

const sortPosts = (posts: NormalizedPost[]): NormalizedPost[] =>
  [...posts].sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())

const latestPost = (posts: NormalizedPost[]): NormalizedPost | null => {
  if (posts.length === 0) {
    return null
  }
  return sortPosts(posts)[posts.length - 1] ?? null
}

const shouldUseFallback = (feed: Feed): boolean => feed.fallbackEnabled

const isFreshByAgePolicy = (post: NormalizedPost): boolean => {
  if (env.MAX_POST_AGE_HOURS <= 0) {
    return true
  }
  const publishedMs = new Date(post.publishedAt).getTime()
  if (!Number.isFinite(publishedMs)) {
    return false
  }
  const maxAgeMs = env.MAX_POST_AGE_HOURS * 60 * 60 * 1000
  return Date.now() - publishedMs <= maxAgeMs
}

export class FeedProcessor {
  public async processFeed(feed: Feed): Promise<void> {
    const adapter = getAdapter(feed)
    const polledAt = nowIso()
    try {
      const posts = await adapter.fetchLatest(feed)
      const freshPosts = posts.filter(isFreshByAgePolicy)
      let candidates = sortPosts(freshPosts)
      let bootstrapUsed = false
      if (candidates.length === 0 && posts.length > 0 && eventRepo.countByFeed(feed.id) === 0) {
        const bootstrap = latestPost(posts)
        if (bootstrap) {
          candidates = [bootstrap]
          bootstrapUsed = true
        }
      }
      let insertedEvents = 0
      for (const post of candidates) {
        const eventId = eventRepo.insertIfNew({
          feedId: feed.id,
          source: post.source,
          externalPostId: post.externalPostId,
          publishedAt: post.publishedAt,
          payloadJson: JSON.stringify(post),
        })
        if (!eventId) {
          continue
        }
        insertedEvents += 1
        const queued = deliveryRepo.createPendingByFeed(eventId, feed.id)
        audit("info", "fanout", "Event queued", {
          feedId: feed.id,
          eventId,
          queued,
          externalPostId: post.externalPostId,
        })
      }
      feedRepo.markPolled(feed.id, polledAt)
      feedRepo.setCooldown(feed.id, null)
      audit("info", "poller", "Feed poll complete", {
        feedId: feed.id,
        fetched: posts.length,
        droppedByAgePolicy: posts.length - freshPosts.length,
        newEvents: insertedEvents,
        bootstrapUsed,
      })
    } catch (error) {
      if (error instanceof UpstreamRateLimitError) {
        const cooldown = isoAfterMs(error.retryAfterMs ?? defaultCooldownMs)
        feedRepo.setCooldown(feed.id, cooldown)
        feedRepo.markPolled(feed.id, polledAt)
        audit("warn", "poller", "Upstream rate limited feed", {
          feedId: feed.id,
          cooldownUntil: cooldown,
          fallbackEnabled: shouldUseFallback(feed),
        })
        return
      }
      if (error instanceof UpstreamTemporaryError) {
        const cooldown = isoAfterMs(60 * 1000)
        feedRepo.setCooldown(feed.id, cooldown)
        feedRepo.markPolled(feed.id, polledAt)
        audit("warn", "poller", "Upstream temporary error", {
          feedId: feed.id,
          cooldownUntil: cooldown,
          error: error.message,
        })
        return
      }
      feedRepo.markPolled(feed.id, polledAt)
      const message = error instanceof Error ? error.message : "Unknown poll error"
      audit("error", "poller", "Feed poll failed", { feedId: feed.id, error: message })
    }
  }
}
