export type Platform = "twitter" | "youtube" | "hoyolab"

export const HOYOLAB_LANGUAGES = [
  "en-us",
  "zh-cn",
  "zh-tw",
  "de-de",
  "es-es",
  "fr-fr",
  "id-id",
  "it-it",
  "ja-jp",
  "ko-kr",
  "pt-pt",
  "ru-ru",
  "th-th",
  "tr-tr",
  "vi-vn",
] as const

export type HoyoLabLanguage = (typeof HOYOLAB_LANGUAGES)[number]

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

export type DeliveryStatus = Record<string, number>

export type RateLimitSnapshot = {
  webhookId: number
  blockedUntil: number
  remaining: number | null
  resetAt: number | null
}

export type LogRow = {
  id: number
  level: string
  component: string
  message: string
  meta_json: string | null
  created_at: string
}
