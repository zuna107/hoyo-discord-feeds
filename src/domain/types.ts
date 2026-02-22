import type { HoyoLabLanguage } from "./hoyolabLanguages.js"

export type Platform = "twitter" | "youtube" | "hoyolab"

export type Feed = {
  id: number
  platform: Platform
  identifier: string
  displayName: string
  language: HoyoLabLanguage
  pollingIntervalSec: number
  active: boolean
  fallbackEnabled: boolean
  lastPolledAt: string | null
  cooldownUntil: string | null
}

export type Webhook = {
  id: number
  name: string
  url: string
  serverName: string | null
  active: boolean
}

export type Subscription = {
  id: number
  feedId: number
  webhookId: number
  categoryTag: string | null
  active: boolean
}

export type NormalizedPost = {
  source: Platform
  feedId: number
  externalPostId: string
  publishedAt: string
  title: string
  text: string
  url: string
  authorName: string
  authorUrl?: string
  authorIconUrl?: string
  media: Array<{ type: "image" | "video" | "link"; url: string }>
  tags: string[]
  raw: unknown
}

export type DeliveryStatus = "pending" | "retry" | "sent" | "failed" | "dead"

export type RateLimitState = {
  webhookId: number
  blockedUntil: number
  remaining: number | null
  resetAt: number | null
}

export type RetryPlan = {
  nextRetryAtIso: string
  status: DeliveryStatus
  shouldRetry: boolean
}
