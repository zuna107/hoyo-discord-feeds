import { db } from "./client.js"
import type { DeliveryStatus, Feed, Platform, Subscription, Webhook } from "../domain/types.js"
import { nowIso } from "../utils/time.js"

type FeedInput = {
  platform: Platform
  identifier: string
  displayName: string
  language?: Feed["language"]
  pollingIntervalSec?: number
  active?: boolean
  fallbackEnabled?: boolean
}

type WebhookInput = {
  name: string
  url: string
  serverName?: string | null
  active?: boolean
}

type SubscriptionInput = {
  feedId: number
  webhookId: number
  categoryTag?: string | null
  active?: boolean
}

type DeliveryRecord = {
  id: number
  eventId: number
  webhookId: number
  status: DeliveryStatus
  attempt: number
  nextRetryAt: string | null
  webhookUrl: string
  webhookName: string
  payloadJson: string
}

type ReusableIdTable = "feeds" | "webhooks" | "subscriptions"

const nextReusableId = (table: ReusableIdTable): number => {
  const rows = db
    .prepare(`SELECT id FROM ${table} ORDER BY id ASC`)
    .all() as Array<{ id: number }>
  let expected = 1
  for (const row of rows) {
    if (row.id > expected) {
      break
    }
    if (row.id === expected) {
      expected += 1
    }
  }
  return expected
}

const mapFeed = (row: Record<string, unknown>): Feed => ({
  id: Number(row.id),
  platform: row.platform as Platform,
  identifier: String(row.identifier),
  displayName: String(row.display_name),
  language: String(row.language ?? "en-us") as Feed["language"],
  pollingIntervalSec: Number(row.polling_interval_sec),
  active: Number(row.active) === 1,
  fallbackEnabled: Number(row.fallback_enabled) === 1,
  lastPolledAt: (row.last_polled_at as string | null) ?? null,
  cooldownUntil: (row.cooldown_until as string | null) ?? null,
})

const mapWebhook = (row: Record<string, unknown>): Webhook => ({
  id: Number(row.id),
  name: String(row.name),
  url: String(row.url),
  serverName: (row.server_name as string | null) ?? null,
  active: Number(row.active) === 1,
})

const mapSubscription = (row: Record<string, unknown>): Subscription => ({
  id: Number(row.id),
  feedId: Number(row.feed_id),
  webhookId: Number(row.webhook_id),
  categoryTag: (row.category_tag as string | null) ?? null,
  active: Number(row.active) === 1,
})

export const feedRepo = {
  list(): Feed[] {
    const rows = db
      .prepare("SELECT * FROM feeds ORDER BY id DESC")
      .all() as Array<Record<string, unknown>>
    return rows.map(mapFeed)
  },
  listDue(now: string): Feed[] {
    const rows = db
      .prepare(
        `
        SELECT *
        FROM feeds
        WHERE active = 1
          AND (cooldown_until IS NULL OR cooldown_until <= ?)
          AND (
            last_polled_at IS NULL
            OR (strftime('%s', ?) - strftime('%s', last_polled_at)) >= polling_interval_sec
          )
        ORDER BY id ASC
        `
      )
      .all(now, now) as Array<Record<string, unknown>>
    return rows.map(mapFeed)
  },
  create(input: FeedInput): Feed {
    const createdAt = nowIso()
    const id = nextReusableId("feeds")
    const stmt = db.prepare(
      `
      INSERT INTO feeds (id, platform, identifier, display_name, language, polling_interval_sec, active, fallback_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    const result = stmt.run(
      id,
      input.platform,
      input.identifier,
      input.displayName,
      input.language ?? "en-us",
      input.pollingIntervalSec ?? 180,
      (input.active ?? true) ? 1 : 0,
      (input.fallbackEnabled ?? false) ? 1 : 0,
      createdAt,
      createdAt
    )
    const row = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      throw new Error("Failed to load created feed")
    }
    return mapFeed(row)
  },
  update(id: number, input: Partial<FeedInput>): Feed | null {
    const existing = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) {
      return null
    }
    const updated = {
      platform: input.platform ?? String(existing.platform),
      identifier: input.identifier ?? String(existing.identifier),
      display_name: input.displayName ?? String(existing.display_name),
      language: input.language ?? String(existing.language ?? "en-us"),
      polling_interval_sec: input.pollingIntervalSec ?? Number(existing.polling_interval_sec),
      active: (input.active ?? Number(existing.active) === 1) ? 1 : 0,
      fallback_enabled: (input.fallbackEnabled ?? Number(existing.fallback_enabled) === 1) ? 1 : 0,
    }
    db.prepare(
      `
      UPDATE feeds
      SET platform = ?, identifier = ?, display_name = ?, language = ?, polling_interval_sec = ?,
          active = ?, fallback_enabled = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(
      updated.platform,
      updated.identifier,
      updated.display_name,
      updated.language,
      updated.polling_interval_sec,
      updated.active,
      updated.fallback_enabled,
      nowIso(),
      id
    )
    const row = db.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Record<string, unknown>
    return mapFeed(row)
  },
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM feeds WHERE id = ?").run(id)
    return result.changes > 0
  },
  markPolled(id: number, polledAt: string): void {
    db.prepare("UPDATE feeds SET last_polled_at = ?, updated_at = ? WHERE id = ?").run(
      polledAt,
      polledAt,
      id
    )
  },
  setCooldown(id: number, until: string | null): void {
    db.prepare("UPDATE feeds SET cooldown_until = ?, updated_at = ? WHERE id = ?").run(
      until,
      nowIso(),
      id
    )
  },
}

export const webhookRepo = {
  list(): Webhook[] {
    const rows = db
      .prepare("SELECT * FROM webhooks ORDER BY id DESC")
      .all() as Array<Record<string, unknown>>
    return rows.map(mapWebhook)
  },
  create(input: WebhookInput): Webhook {
    const ts = nowIso()
    const id = nextReusableId("webhooks")
    const result = db
      .prepare(
        `
        INSERT INTO webhooks (id, name, url, server_name, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(id, input.name, input.url, input.serverName ?? null, (input.active ?? true) ? 1 : 0, ts, ts)
    const row = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      throw new Error("Failed to load created webhook")
    }
    return mapWebhook(row)
  },
  update(id: number, input: Partial<WebhookInput>): Webhook | null {
    const existing = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) {
      return null
    }
    const next = {
      name: input.name ?? String(existing.name),
      url: input.url ?? String(existing.url),
      serverName: input.serverName ?? ((existing.server_name as string | null) ?? null),
      active: (input.active ?? Number(existing.active) === 1) ? 1 : 0,
    }
    db.prepare(
      `
      UPDATE webhooks
      SET name = ?, url = ?, server_name = ?, active = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(next.name, next.url, next.serverName, next.active, nowIso(), id)
    const row = db.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as Record<string, unknown>
    return mapWebhook(row)
  },
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM webhooks WHERE id = ?").run(id)
    return result.changes > 0
  },
}

export const subscriptionRepo = {
  list(): Subscription[] {
    const rows = db
      .prepare("SELECT * FROM subscriptions ORDER BY id DESC")
      .all() as Array<Record<string, unknown>>
    return rows.map(mapSubscription)
  },
  create(input: SubscriptionInput): Subscription {
    const ts = nowIso()
    const id = nextReusableId("subscriptions")
    const result = db
      .prepare(
        `
        INSERT INTO subscriptions (id, feed_id, webhook_id, category_tag, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        input.feedId,
        input.webhookId,
        input.categoryTag ?? null,
        (input.active ?? true) ? 1 : 0,
        ts,
        ts
      )
    const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) {
      throw new Error("Failed to load created subscription")
    }
    return mapSubscription(row)
  },
  update(id: number, input: Partial<SubscriptionInput>): Subscription | null {
    const existing = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) {
      return null
    }
    const next = {
      feedId: input.feedId ?? Number(existing.feed_id),
      webhookId: input.webhookId ?? Number(existing.webhook_id),
      categoryTag: input.categoryTag ?? ((existing.category_tag as string | null) ?? null),
      active: (input.active ?? Number(existing.active) === 1) ? 1 : 0,
    }
    db.prepare(
      `
      UPDATE subscriptions
      SET feed_id = ?, webhook_id = ?, category_tag = ?, active = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(next.feedId, next.webhookId, next.categoryTag, next.active, nowIso(), id)
    const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Record<string, unknown>
    return mapSubscription(row)
  },
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id)
    return result.changes > 0
  },
}

export const eventRepo = {
  countByFeed(feedId: number): number {
    const row = db.prepare("SELECT COUNT(*) AS c FROM events WHERE feed_id = ?").get(feedId) as
      | Record<string, unknown>
      | undefined
    return Number(row?.c ?? 0)
  },
  insertIfNew(input: {
    feedId: number
    source: Platform
    externalPostId: string
    publishedAt: string
    payloadJson: string
  }): number | null {
    const result = db
      .prepare(
        `
        INSERT INTO events (feed_id, source, external_post_id, payload_json, published_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, external_post_id) DO NOTHING
        `
      )
      .run(
        input.feedId,
        input.source,
        input.externalPostId,
        input.payloadJson,
        input.publishedAt,
        nowIso()
      )
    if (result.changes === 0) {
      return null
    }
    return Number(result.lastInsertRowid)
  },
}

export const deliveryRepo = {
  createPendingByFeed(eventId: number, feedId: number): number {
    const result = db
      .prepare(
        `
        INSERT INTO deliveries (event_id, webhook_id, status, attempt, next_retry_at, created_at, updated_at)
        SELECT ?, s.webhook_id, 'pending', 0, NULL, ?, ?
        FROM subscriptions s
        INNER JOIN webhooks w ON w.id = s.webhook_id
        WHERE s.feed_id = ? AND s.active = 1 AND w.active = 1
        GROUP BY s.webhook_id
        ON CONFLICT(event_id, webhook_id) DO NOTHING
        `
      )
      .run(eventId, nowIso(), nowIso(), feedId)
    return result.changes
  },
  backfillLatestForSubscription(
    feedId: number,
    webhookId: number,
    limit: number,
    publishedAfterIso: string | null
  ): number {
    if (limit <= 0) {
      return 0
    }
    const ts = nowIso()
    const withFilter = `
      INSERT INTO deliveries (event_id, webhook_id, status, attempt, next_retry_at, created_at, updated_at)
      SELECT e.id, ?, 'pending', 0, NULL, ?, ?
      FROM events e
      WHERE e.feed_id = ?
        AND e.published_at >= ?
      ORDER BY e.published_at DESC
      LIMIT ?
      ON CONFLICT(event_id, webhook_id) DO NOTHING
    `
    const withoutFilter = `
      INSERT INTO deliveries (event_id, webhook_id, status, attempt, next_retry_at, created_at, updated_at)
      SELECT e.id, ?, 'pending', 0, NULL, ?, ?
      FROM events e
      WHERE e.feed_id = ?
      ORDER BY e.published_at DESC
      LIMIT ?
      ON CONFLICT(event_id, webhook_id) DO NOTHING
    `
    const result =
      publishedAfterIso !== null
        ? db.prepare(withFilter).run(webhookId, ts, ts, feedId, publishedAfterIso, limit)
        : db.prepare(withoutFilter).run(webhookId, ts, ts, feedId, limit)
    return result.changes
  },
  listDue(limit: number, now: string): DeliveryRecord[] {
    const rows = db
      .prepare(
        `
        SELECT d.id, d.event_id, d.webhook_id, d.status, d.attempt, d.next_retry_at,
               w.url AS webhook_url, w.name AS webhook_name,
               e.payload_json
        FROM deliveries d
        INNER JOIN webhooks w ON w.id = d.webhook_id
        INNER JOIN events e ON e.id = d.event_id
        WHERE d.status IN ('pending', 'retry')
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)
        ORDER BY d.created_at ASC
        LIMIT ?
        `
      )
      .all(now, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: Number(row.id),
      eventId: Number(row.event_id),
      webhookId: Number(row.webhook_id),
      status: row.status as DeliveryStatus,
      attempt: Number(row.attempt),
      nextRetryAt: (row.next_retry_at as string | null) ?? null,
      webhookUrl: String(row.webhook_url),
      webhookName: String(row.webhook_name),
      payloadJson: String(row.payload_json),
    }))
  },
  markSent(deliveryId: number, responseCode: number): void {
    db.prepare(
      `
      UPDATE deliveries
      SET status = 'sent', response_code = ?, last_error = NULL,
          last_attempt_at = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(responseCode, nowIso(), nowIso(), deliveryId)
  },
  markRetry(
    deliveryId: number,
    nextRetryAt: string,
    attempt: number,
    errorMessage: string,
    responseCode: number | null
  ): void {
    db.prepare(
      `
      UPDATE deliveries
      SET status = 'retry', attempt = ?, next_retry_at = ?, last_error = ?,
          response_code = ?, last_attempt_at = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(attempt, nextRetryAt, errorMessage, responseCode, nowIso(), nowIso(), deliveryId)
  },
  markDead(deliveryId: number, attempt: number, errorMessage: string, responseCode: number | null): void {
    db.prepare(
      `
      UPDATE deliveries
      SET status = 'dead', attempt = ?, last_error = ?, response_code = ?,
          last_attempt_at = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(attempt, errorMessage, responseCode, nowIso(), nowIso(), deliveryId)
  },
  countsByStatus(): Record<string, number> {
    const rows = db
      .prepare("SELECT status, COUNT(*) AS c FROM deliveries GROUP BY status")
      .all() as Array<Record<string, unknown>>
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.status)] = Number(row.c)
      return acc
    }, {})
  },
}

export const logRepo = {
  write(level: string, component: string, message: string, meta?: Record<string, unknown>): void {
    db.prepare(
      `
      INSERT INTO logs (level, component, message, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(level, component, message, meta ? JSON.stringify(meta) : null, nowIso())
  },
  list(limit = 200): Array<Record<string, unknown>> {
    return db
      .prepare(
        `
        SELECT id, level, component, message, meta_json, created_at
        FROM logs
        ORDER BY id DESC
        LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>
  },
  clear(): number {
    const result = db.prepare("DELETE FROM logs").run()
    return result.changes
  },
}
