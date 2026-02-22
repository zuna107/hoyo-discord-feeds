import { env } from "../config/env.js"
import type { Feed, NormalizedPost } from "../domain/types.js"
import type { SourceAdapter } from "./base.js"
import { UpstreamRateLimitError, UpstreamTemporaryError } from "../services/errors.js"

type TwitterTweet = {
  id: string
  text: string
  created_at?: string
}

type TwitterResponse = {
  data?: TwitterTweet[]
}

type TwitterUserLookupResponse = {
  data?: {
    id?: string
    username?: string
  }
}

const usernameToIdCache = new Map<string, string>()

const parseRetryAfterMs = (response: Response): number | null => {
  const retryAfter = response.headers.get("retry-after")
  if (!retryAfter) {
    return null
  }
  const seconds = Number(retryAfter)
  if (!Number.isFinite(seconds)) {
    return null
  }
  return Math.max(0, Math.round(seconds * 1000))
}

const isNumericId = (value: string): boolean => /^\d+$/.test(value)

const normalizeIdentifier = (value: string): string => value.trim().replace(/^@+/, "")

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const body = await response.text()
    return body.slice(0, 300)
  } catch {
    return ""
  }
}

const resolveTwitterUserId = async (identifier: string): Promise<string> => {
  const normalized = normalizeIdentifier(identifier)
  if (isNumericId(normalized)) {
    return normalized
  }
  const cached = usernameToIdCache.get(normalized.toLowerCase())
  if (cached) {
    return cached
  }

  const lookupUrl = `https://api.x.com/2/users/by/username/${encodeURIComponent(normalized)}`
  const response = await fetch(lookupUrl, {
    headers: { Authorization: `Bearer ${env.TWITTER_BEARER_TOKEN}` },
  })
  if (response.status === 429) {
    throw new UpstreamRateLimitError("Twitter API rate limited during user lookup", parseRetryAfterMs(response))
  }
  if (response.status >= 500) {
    throw new UpstreamTemporaryError(`Twitter API temporary error ${response.status} during user lookup`)
  }
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(`Twitter user lookup failed with ${response.status}${body ? `: ${body}` : ""}`)
  }

  const payload = (await response.json()) as TwitterUserLookupResponse
  const id = payload.data?.id
  if (!id) {
    throw new Error(`Twitter username not found: ${normalized}`)
  }
  usernameToIdCache.set(normalized.toLowerCase(), id)
  return id
}

export class TwitterAdapter implements SourceAdapter {
  public supports(platform: Feed["platform"]): boolean {
    return platform === "twitter"
  }

  public async fetchLatest(feed: Feed): Promise<NormalizedPost[]> {
    if (!env.TWITTER_BEARER_TOKEN) {
      return []
    }
    const userId = await resolveTwitterUserId(feed.identifier)
    const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets`)
    url.searchParams.set("max_results", "5")
    url.searchParams.set("exclude", "retweets,replies")
    url.searchParams.set("tweet.fields", "created_at")
    if (env.MAX_POST_AGE_HOURS > 0) {
      const startTime = new Date(Date.now() - env.MAX_POST_AGE_HOURS * 60 * 60 * 1000).toISOString()
      url.searchParams.set("start_time", startTime)
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.TWITTER_BEARER_TOKEN}` },
    })
    if (response.status === 429) {
      throw new UpstreamRateLimitError("Twitter API rate limited", parseRetryAfterMs(response))
    }
    if (response.status >= 500) {
      throw new UpstreamTemporaryError(`Twitter API temporary error ${response.status}`)
    }
    if (!response.ok) {
      const body = await readErrorBody(response)
      throw new Error(`Twitter API failed with ${response.status}${body ? `: ${body}` : ""}`)
    }
    const body = (await response.json()) as TwitterResponse
    const posts = body.data ?? []
    return posts.map((post) => ({
      source: "twitter",
      feedId: feed.id,
      externalPostId: post.id,
      publishedAt: post.created_at ?? new Date().toISOString(),
      title: feed.displayName,
      text: post.text,
      url: `https://x.com/i/web/status/${post.id}`,
      authorName: feed.displayName,
      media: [],
      tags: [],
      raw: post,
    }))
  }
}
