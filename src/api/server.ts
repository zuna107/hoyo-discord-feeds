import Fastify from "fastify"
import cors from "@fastify/cors"
import { env } from "../config/env.js"
import {
  deliveryRepo,
  feedRepo,
  logRepo,
  subscriptionRepo,
  webhookRepo,
} from "../db/repositories.js"
import { HOYOLAB_LANGUAGES } from "../domain/hoyolabLanguages.js"
import { audit } from "../services/audit.js"
import { dashboardAuth } from "../services/dashboardAuth.js"
import { SchedulerService } from "../services/scheduler.js"
import { z } from "zod"
import { isoAfterMs } from "../utils/time.js"

const feedBodySchema = z.object({
  platform: z.enum(["twitter", "youtube", "hoyolab"]),
  identifier: z.string().min(1),
  displayName: z.string().min(1),
  language: z.enum(HOYOLAB_LANGUAGES).optional(),
  pollingIntervalSec: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  fallbackEnabled: z.boolean().optional(),
})

const webhookBodySchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  serverName: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

const subscriptionBodySchema = z.object({
  feedId: z.number().int().positive(),
  webhookId: z.number().int().positive(),
  categoryTag: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

const authSetupSchema = z.object({
  setupKey: z.string().min(1),
})

const authCodeSchema = z.object({
  code: z.string().min(6).max(12),
})

const parseId = (value: unknown): number => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid id")
  }
  return id
}

const extractBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) {
    return null
  }
  const [scheme, token] = authorization.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null
  }
  return token.trim()
}

export const buildApiServer = (scheduler: SchedulerService) => {
  const app = Fastify({ logger: false })
  void app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  })

  app.addHook("preHandler", async (request, reply) => {
    if (!env.DASHBOARD_AUTH_ENABLED) {
      return
    }
    const path = request.url.split("?")[0]
    if (path === "/health" || path.startsWith("/auth/")) {
      return
    }
    const token = extractBearerToken(request.headers.authorization)
    const session = dashboardAuth.validateSession(token)
    if (!session.valid) {
      return reply.status(401).send({ message: "Unauthorized" })
    }
  })

  app.get("/health", async () => ({
    status: "ok",
    ts: new Date().toISOString(),
    role: env.ROLE,
  }))

  app.get("/auth/status", async () => dashboardAuth.status())
  app.post("/auth/setup/start", async (request) => {
    const body = authSetupSchema.parse(request.body)
    return dashboardAuth.setupStart(body.setupKey)
  })
  app.post("/auth/setup/verify", async (request) => {
    const body = authCodeSchema.parse(request.body)
    return dashboardAuth.setupVerify(body.code)
  })
  app.post("/auth/login", async (request) => {
    const body = authCodeSchema.parse(request.body)
    return dashboardAuth.login(body.code)
  })
  app.get("/auth/session", async (request) => {
    if (!env.DASHBOARD_AUTH_ENABLED) {
      return { valid: true, expiresAt: null }
    }
    const token = extractBearerToken(request.headers.authorization)
    return dashboardAuth.validateSession(token)
  })
  app.post("/auth/logout", async (request) => {
    if (!env.DASHBOARD_AUTH_ENABLED) {
      return { status: "ok" }
    }
    const token = extractBearerToken(request.headers.authorization)
    dashboardAuth.logout(token)
    return { status: "ok" }
  })

  app.get("/feeds", async () => feedRepo.list())
  app.post("/feeds", async (request, reply) => {
    const body = feedBodySchema.parse(request.body)
    const created = feedRepo.create(body)
    return reply.code(201).send(created)
  })
  app.put("/feeds/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const body = feedBodySchema.partial().parse(request.body)
    const updated = feedRepo.update(id, body)
    if (!updated) {
      return reply.code(404).send({ message: "Feed not found" })
    }
    return updated
  })
  app.delete("/feeds/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const removed = feedRepo.delete(id)
    if (!removed) {
      return reply.code(404).send({ message: "Feed not found" })
    }
    return reply.code(204).send()
  })

  app.get("/webhooks", async () => webhookRepo.list())
  app.post("/webhooks", async (request, reply) => {
    const body = webhookBodySchema.parse(request.body)
    const created = webhookRepo.create(body)
    return reply.code(201).send(created)
  })
  app.put("/webhooks/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const body = webhookBodySchema.partial().parse(request.body)
    const updated = webhookRepo.update(id, body)
    if (!updated) {
      return reply.code(404).send({ message: "Webhook not found" })
    }
    return updated
  })
  app.delete("/webhooks/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const removed = webhookRepo.delete(id)
    if (!removed) {
      return reply.code(404).send({ message: "Webhook not found" })
    }
    return reply.code(204).send()
  })

  app.get("/subscriptions", async () => subscriptionRepo.list())
  app.post("/subscriptions", async (request, reply) => {
    const body = subscriptionBodySchema.parse(request.body)
    const created = subscriptionRepo.create(body)
    const publishedAfterIso =
      env.MAX_POST_AGE_HOURS > 0 ? isoAfterMs(-env.MAX_POST_AGE_HOURS * 60 * 60 * 1000) : null
    const backfilled = deliveryRepo.backfillLatestForSubscription(
      created.feedId,
      created.webhookId,
      env.SUBSCRIPTION_BACKFILL_COUNT,
      publishedAfterIso
    )
    if (backfilled > 0) {
      audit("info", "fanout", "Subscription backfill queued", {
        subscriptionId: created.id,
        feedId: created.feedId,
        webhookId: created.webhookId,
        backfilled,
      })
    }
    return reply.code(201).send(created)
  })
  app.put("/subscriptions/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const body = subscriptionBodySchema.partial().parse(request.body)
    const updated = subscriptionRepo.update(id, body)
    if (!updated) {
      return reply.code(404).send({ message: "Subscription not found" })
    }
    return updated
  })
  app.delete("/subscriptions/:id", async (request, reply) => {
    const id = parseId((request.params as Record<string, unknown>).id)
    const removed = subscriptionRepo.delete(id)
    if (!removed) {
      return reply.code(404).send({ message: "Subscription not found" })
    }
    return reply.code(204).send()
  })

  app.get("/logs", async (request) => {
    const query = request.query as { limit?: string | number }
    const limit = Math.min(500, Number(query.limit ?? 200))
    return logRepo.list(Number.isFinite(limit) ? limit : 200)
  })
  app.delete("/logs", async () => {
    const removed = logRepo.clear()
    return { removed }
  })

  app.get("/status/deliveries", async () => deliveryRepo.countsByStatus())
  app.get("/status/rate-limits", async () => scheduler.getDispatcher().getRateLimitSnapshot())

  app.post("/ops/tick", async () => {
    await scheduler.tick()
    return { status: "ok" }
  })

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown API error"
    audit("error", "api", message)
    reply.status(400).send({
      message,
    })
  })

  return app
}
