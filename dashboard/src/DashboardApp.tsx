import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import type {
  DeliveryStatus,
  Feed,
  HoyoLabLanguage,
  LogRow,
  Platform,
  RateLimitSnapshot,
  Subscription,
  Webhook,
} from "./types"
import { HOYOLAB_LANGUAGES } from "./types"

type FeedForm = {
  platform: Platform
  identifier: string
  displayName: string
  language: HoyoLabLanguage
  pollingIntervalSec: number
}

type WebhookForm = {
  name: string
  url: string
  serverName: string
}

type SubscriptionForm = {
  feedId: string
  webhookId: string
  categoryTag: string
}

const defaultFeedForm: FeedForm = {
  platform: "twitter",
  identifier: "",
  displayName: "",
  language: "en-us",
  pollingIntervalSec: 180,
}

const defaultWebhookForm: WebhookForm = {
  name: "",
  url: "",
  serverName: "",
}

const defaultSubscriptionForm: SubscriptionForm = {
  feedId: "",
  webhookId: "",
  categoryTag: "",
}

const JAKARTA_TZ = "Asia/Jakarta"

const formatUtcToJakarta = (value: string | null | undefined): string => {
  if (!value) {
    return "-"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

const formatEpochMsToJakarta = (value: number | null | undefined): string => {
  if (!value || value <= 0) {
    return "-"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

const summarizeLogMeta = (metaJson: string | null): string => {
  if (!metaJson) {
    return ""
  }
  try {
    const meta = JSON.parse(metaJson) as Record<string, unknown>
    const parts: string[] = []
    const pushIfNumber = (key: string) => {
      const value = meta[key]
      if (typeof value === "number") {
        parts.push(`${key}=${value}`)
      }
    }
    pushIfNumber("feedId")
    pushIfNumber("fetched")
    pushIfNumber("droppedByAgePolicy")
    pushIfNumber("newEvents")
    pushIfNumber("dispatched")
    pushIfNumber("dueFeeds")
    if (typeof meta.cooldownUntil === "string") {
      parts.push(`cooldownUntil=${formatUtcToJakarta(meta.cooldownUntil)}`)
    }
    return parts.join(" | ")
  } catch {
    return ""
  }
}

type DashboardAppProps = {
  onLogout?: () => void
}

export const DashboardApp = ({ onLogout }: DashboardAppProps) => {
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>({})
  const [rateLimits, setRateLimits] = useState<RateLimitSnapshot[]>([])
  const [feedForm, setFeedForm] = useState<FeedForm>(defaultFeedForm)
  const [webhookForm, setWebhookForm] = useState<WebhookForm>(defaultWebhookForm)
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionForm>(defaultSubscriptionForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setBusy(true)
    setError("")
    try {
      const [nextFeeds, nextWebhooks, nextSubs, nextLogs, nextDelivery, nextLimits] =
        await Promise.all([
          api.feeds(),
          api.webhooks(),
          api.subscriptions(),
          api.logs(),
          api.deliveryStatus(),
          api.rateLimits(),
        ])
      setFeeds(nextFeeds)
      setWebhooks(nextWebhooks)
      setSubscriptions(nextSubs)
      setLogs(nextLogs)
      setDeliveryStatus(nextDelivery)
      setRateLimits(nextLimits)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 10000)
    return () => clearInterval(timer)
  }, [refresh])

  const feedNameById = useMemo(
    () => new Map(feeds.map((feed) => [feed.id, `#${feed.id} ${feed.platform}:${feed.displayName}`])),
    [feeds]
  )
  const webhookNameById = useMemo(
    () =>
      new Map(
        webhooks.map((wh) => [
          wh.id,
          `#${wh.id} ${wh.name}${wh.serverName ? ` (${wh.serverName})` : ""}`,
        ])
      ),
    [webhooks]
  )

  const onCreateFeed = async (event: FormEvent) => {
    event.preventDefault()
    await api.createFeed(feedForm)
    setFeedForm(defaultFeedForm)
    await refresh()
  }

  const onCreateWebhook = async (event: FormEvent) => {
    event.preventDefault()
    await api.createWebhook({
      ...webhookForm,
      serverName: webhookForm.serverName || null,
    })
    setWebhookForm(defaultWebhookForm)
    await refresh()
  }

  const onCreateSubscription = async (event: FormEvent) => {
    event.preventDefault()
    if (!subscriptionForm.feedId || !subscriptionForm.webhookId) {
      setError("Please select feed and webhook first.")
      return
    }
    await api.createSubscription({
      feedId: Number(subscriptionForm.feedId),
      webhookId: Number(subscriptionForm.webhookId),
      categoryTag: subscriptionForm.categoryTag || null,
    })
    setSubscriptionForm((prev) => ({ ...defaultSubscriptionForm, feedId: prev.feedId, webhookId: prev.webhookId }))
    await refresh()
  }

  const levelClassName = (level: string): string => {
    const normalized = level.toLowerCase()
    if (normalized === "error") {
      return "badge badge-error"
    }
    if (normalized === "warn") {
      return "badge badge-warn"
    }
    if (normalized === "info") {
      return "badge badge-info"
    }
    return "badge"
  }

  const componentClassName = (component: string): string => {
    const normalized = component.toLowerCase()
    if (normalized === "api") {
      return "badge badge-api"
    }
    if (normalized === "dispatch" || normalized === "fanout") {
      return "badge badge-dispatch"
    }
    if (normalized === "scheduler" || normalized === "poller") {
      return "badge badge-worker"
    }
    return ""
  }

  return (
    <main className="layout">
      <header>
        <h1>Feed Engine Dashboard</h1>
        <p>Discord Feed Engine Service</p>
        <div className="actions">
          <button onClick={() => void api.tick().then(refresh)}>Run Tick</button>
          <button onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
          {onLogout ? <button onClick={onLogout}>Logout</button> : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </header>

      <section className="card">
        <h2>Create Feed</h2>
        <form onSubmit={onCreateFeed} className="grid">
          <label>
            Platform
            <select
              value={feedForm.platform}
              onChange={(event) =>
                setFeedForm((prev) => ({ ...prev, platform: event.target.value as Platform }))
              }
            >
              <option value="twitter">twitter</option>
              <option value="youtube">youtube</option>
              <option value="hoyolab">hoyolab</option>
            </select>
          </label>
          <label>
            Identifier
            <input
              value={feedForm.identifier}
              onChange={(event) => setFeedForm((prev) => ({ ...prev, identifier: event.target.value }))}
              placeholder="user id / channel id / uid"
              required
            />
          </label>
          <label>
            Display Name
            <input
              value={feedForm.displayName}
              onChange={(event) => setFeedForm((prev) => ({ ...prev, displayName: event.target.value }))}
              required
            />
          </label>
          <label>
            HoYoLAB Language
            <select
              value={feedForm.language}
              onChange={(event) =>
                setFeedForm((prev) => ({ ...prev, language: event.target.value as HoyoLabLanguage }))
              }
              disabled={feedForm.platform !== "hoyolab"}
            >
              {HOYOLAB_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>
          <label>
            Poll Interval (sec)
            <input
              type="number"
              min={30}
              value={feedForm.pollingIntervalSec}
              onChange={(event) =>
                setFeedForm((prev) => ({ ...prev, pollingIntervalSec: Number(event.target.value) }))
              }
              required
            />
          </label>
          <button type="submit">Add Feed</button>
        </form>
      </section>

      <section className="card">
        <h2>Create Webhook</h2>
        <form onSubmit={onCreateWebhook} className="grid">
          <label>
            Name
            <input
              value={webhookForm.name}
              onChange={(event) => setWebhookForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
          </label>
          <label>
            URL
            <input
              value={webhookForm.url}
              onChange={(event) => setWebhookForm((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://discord.com/api/webhooks/..."
              required
            />
          </label>
          <label>
            Server Name
            <input
              value={webhookForm.serverName}
              onChange={(event) => setWebhookForm((prev) => ({ ...prev, serverName: event.target.value }))}
              placeholder="optional"
            />
          </label>
          <button type="submit">Add Webhook</button>
        </form>
      </section>

      <section className="card">
        <h2>Create Subscription</h2>
        <form onSubmit={onCreateSubscription} className="grid">
          <label>
            Feed
            <select
              value={subscriptionForm.feedId}
              onChange={(event) =>
                setSubscriptionForm((prev) => ({ ...prev, feedId: event.target.value }))
              }
            >
              <option value="" disabled>
                Select feed
              </option>
              {feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  #{feed.id} - {feed.platform}:{feed.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Webhook
            <select
              value={subscriptionForm.webhookId}
              onChange={(event) =>
                setSubscriptionForm((prev) => ({ ...prev, webhookId: event.target.value }))
              }
            >
              <option value="" disabled>
                Select webhook
              </option>
              {webhooks.map((webhook) => (
                <option key={webhook.id} value={webhook.id}>
                  #{webhook.id} - {webhook.name}
                  {webhook.serverName ? ` (${webhook.serverName})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category Tag
            <input
              value={subscriptionForm.categoryTag}
              onChange={(event) =>
                setSubscriptionForm((prev) => ({ ...prev, categoryTag: event.target.value }))
              }
              placeholder="genshin / hsr / hi3"
            />
          </label>
          <button type="submit">Map Feed to Webhook</button>
        </form>
      </section>

      <section className="card">
        <h2>Feeds</h2>
        <p className="time-note">Timezone: Asia/SEA (UTC+7)</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Platform</th>
              <th>Identifier</th>
              <th>Name</th>
              <th>Language</th>
              <th>Interval</th>
              <th>Active</th>
              <th>Last Polled</th>
              <th>Cooldown</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {feeds.map((feed) => (
              <tr key={feed.id}>
                <td>{feed.id}</td>
                <td>{feed.platform}</td>
                <td>{feed.identifier}</td>
                <td>{feed.displayName}</td>
                <td>{feed.language}</td>
                <td>{feed.pollingIntervalSec}</td>
                <td>{String(feed.active)}</td>
                <td>{formatUtcToJakarta(feed.lastPolledAt)}</td>
                <td>{formatUtcToJakarta(feed.cooldownUntil)}</td>
                <td>
                  <button onClick={() => void api.deleteFeed(feed.id).then(refresh)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Webhooks</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Server</th>
              <th>URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {webhooks.map((webhook) => (
              <tr key={webhook.id}>
                <td>{webhook.id}</td>
                <td>{webhook.name}</td>
                <td>{webhook.serverName ?? "-"}</td>
                <td className="truncate">{webhook.url}</td>
                <td>
                  <button onClick={() => void api.deleteWebhook(webhook.id).then(refresh)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Subscriptions</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Feed</th>
              <th>Webhook</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((sub) => (
              <tr key={sub.id}>
                <td>{sub.id}</td>
                <td>{feedNameById.get(sub.feedId) ?? sub.feedId}</td>
                <td>{webhookNameById.get(sub.webhookId) ?? sub.webhookId}</td>
                <td>{sub.categoryTag ?? "-"}</td>
                <td>
                  <button onClick={() => void api.deleteSubscription(sub.id).then(refresh)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card split">
        <div>
          <h2>Delivery Status</h2>
          <ul>
            {Object.entries(deliveryStatus).map(([status, count]) => (
              <li key={status}>
                {status}: {count}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Rate Limit State</h2>
          <table>
            <thead>
              <tr>
                <th>Webhook ID</th>
                <th>Remaining</th>
                <th>Blocked Until</th>
              </tr>
            </thead>
            <tbody>
              {rateLimits.map((item) => (
                <tr key={item.webhookId}>
                  <td>{item.webhookId}</td>
                  <td>{item.remaining ?? "-"}</td>
                  <td>{formatEpochMsToJakarta(item.blockedUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent Logs</h2>
          <button onClick={() => void api.clearLogs().then(refresh)}>Clear Logs</button>
        </div>
        <div className="logs-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Component</th>
                <th>Message</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td>{formatUtcToJakarta(row.created_at)}</td>
                  <td>
                    <span className={levelClassName(row.level)}>{row.level}</span>
                  </td>
                  <td>
                    {componentClassName(row.component) ? (
                      <span className={componentClassName(row.component)}>{row.component}</span>
                    ) : (
                      row.component
                    )}
                  </td>
                  <td>{row.message}</td>
                  <td className="truncate">{summarizeLogMeta(row.meta_json) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
