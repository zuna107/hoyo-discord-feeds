import type {
  DeliveryStatus,
  Feed,
  LogRow,
  RateLimitSnapshot,
  Subscription,
  Webhook,
} from "./types"

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080"
const AUTH_TOKEN_KEY = "dashboard_auth_token"

let authToken: string | null =
  typeof window !== "undefined" ? window.localStorage.getItem(AUTH_TOKEN_KEY) : null

const setAuthToken = (token: string | null): void => {
  authToken = token
  if (typeof window === "undefined") {
    return
  }
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers)
  if (authToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${authToken}`)
  }
  if (init?.body !== undefined && init?.body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!res.ok) {
    const raw = await res.text()
    const body = raw.trim()
    if (body.includes("Cannot GET") || body.startsWith("<!DOCTYPE html")) {
      throw new Error(`API endpoint not found at ${API_BASE}${path}. Check backend URL/version.`)
    }
    let parsedMessage: string | null = null
    try {
      const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
      if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
        parsedMessage = parsed.message
      } else if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
        parsedMessage = parsed.error
      }
    } catch {
      // Fallback to raw body if response is not JSON.
    }
    if (parsedMessage) {
      throw new Error(parsedMessage)
    }
    throw new Error(body || `HTTP ${res.status}`)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

export const api = {
  setAuthToken,
  authStatus: () =>
    req<{ authEnabled: boolean; requiresSetup: boolean; setupStarted: boolean }>("/auth/status"),
  authSetupStart: (setupKey: string) =>
    req<{ qrDataUrl: string; manualKey: string }>("/auth/setup/start", {
      method: "POST",
      body: JSON.stringify({ setupKey }),
    }),
  authSetupVerify: (code: string) =>
    req<{ token: string; expiresAt: string }>("/auth/setup/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authLogin: (code: string) =>
    req<{ token: string; expiresAt: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  authSession: () => req<{ valid: boolean; expiresAt: string | null }>("/auth/session"),
  authLogout: () => req<{ status: string }>("/auth/logout", { method: "POST" }),
  feeds: () => req<Feed[]>("/feeds"),
  webhooks: () => req<Webhook[]>("/webhooks"),
  subscriptions: () => req<Subscription[]>("/subscriptions"),
  logs: () => req<LogRow[]>("/logs?limit=100"),
  deliveryStatus: () => req<DeliveryStatus>("/status/deliveries"),
  rateLimits: () => req<RateLimitSnapshot[]>("/status/rate-limits"),
  createFeed: (input: Partial<Feed>) =>
    req<Feed>("/feeds", { method: "POST", body: JSON.stringify(input) }),
  createWebhook: (input: Partial<Webhook>) =>
    req<Webhook>("/webhooks", { method: "POST", body: JSON.stringify(input) }),
  createSubscription: (input: Partial<Subscription>) =>
    req<Subscription>("/subscriptions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteFeed: (id: number) => req<void>(`/feeds/${id}`, { method: "DELETE" }),
  deleteWebhook: (id: number) =>
    req<void>(`/webhooks/${id}`, { method: "DELETE" }),
  deleteSubscription: (id: number) =>
    req<void>(`/subscriptions/${id}`, { method: "DELETE" }),
  clearLogs: () => req<{ removed: number }>("/logs", { method: "DELETE" }),
  tick: () => req<{ status: string }>("/ops/tick", { method: "POST" }),
}
