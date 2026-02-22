export const schemaSql = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('twitter', 'youtube', 'hoyolab')),
  identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en-us',
  polling_interval_sec INTEGER NOT NULL DEFAULT 180,
  active INTEGER NOT NULL DEFAULT 1,
  fallback_enabled INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT NULL,
  cooldown_until TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feeds_platform_identifier
ON feeds (platform, identifier);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  server_name TEXT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  webhook_id INTEGER NOT NULL,
  category_tag TEXT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique
ON subscriptions (feed_id, webhook_id, IFNULL(category_tag, ''));

CREATE INDEX IF NOT EXISTS idx_subscriptions_feed_active
ON subscriptions (feed_id, active);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  external_post_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_post
ON events (source, external_post_id);

CREATE INDEX IF NOT EXISTS idx_events_feed_id
ON events (feed_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  webhook_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'retry', 'sent', 'failed', 'dead')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NULL,
  last_error TEXT NULL,
  response_code INTEGER NULL,
  last_attempt_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_unique
ON deliveries (event_id, webhook_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_due
ON deliveries (status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  meta_json TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at
ON logs (created_at DESC);

CREATE TABLE IF NOT EXISTS auth_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  totp_secret TEXT NULL,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  setup_completed_at TEXT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO auth_state (id, totp_secret, totp_enabled, setup_completed_at, updated_at)
VALUES (1, NULL, 0, NULL, datetime('now'));

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
ON auth_sessions (expires_at);
`;
