import crypto from "node:crypto"
import { authenticator } from "otplib"
import QRCode from "qrcode"
import { env } from "../config/env.js"
import { db } from "../db/client.js"
import { nowIso } from "../utils/time.js"

type AuthState = {
  totp_secret: string | null
  totp_enabled: number
}

const sessionTtlMs = Math.round(env.DASHBOARD_SESSION_TTL_HOURS * 60 * 60 * 1000)

const stateRow = (): AuthState => {
  const row = db
    .prepare("SELECT totp_secret, totp_enabled FROM auth_state WHERE id = 1")
    .get() as AuthState | undefined
  if (!row) {
    db.prepare(
      "INSERT OR IGNORE INTO auth_state (id, totp_secret, totp_enabled, setup_completed_at, updated_at) VALUES (1, NULL, 0, NULL, ?)"
    ).run(nowIso())
    return { totp_secret: null, totp_enabled: 0 }
  }
  return row
}

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(`${token}:${env.DASHBOARD_SESSION_SECRET}`).digest("hex")

const createSession = (): { token: string; expiresAt: string } => {
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = hashToken(token)
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString()
  db.prepare(
    `
    INSERT OR REPLACE INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    `
  ).run(tokenHash, createdAt, expiresAt, createdAt)
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(nowIso())
  return { token, expiresAt }
}

const validateSetupKey = (setupKey: string): void => {
  if (!env.DASHBOARD_SETUP_KEY) {
    throw new Error("DASHBOARD_SETUP_KEY is not configured.")
  }
  if (setupKey !== env.DASHBOARD_SETUP_KEY) {
    throw new Error("Invalid setup key.")
  }
}

const sanitizeCode = (code: string): string => code.replace(/\s+/g, "")

export const dashboardAuth = {
  status(): { authEnabled: boolean; requiresSetup: boolean; setupStarted: boolean } {
    const state = stateRow()
    if (!env.DASHBOARD_AUTH_ENABLED) {
      return { authEnabled: false, requiresSetup: false, setupStarted: false }
    }
    const setupStarted = Boolean(state.totp_secret)
    const requiresSetup = state.totp_enabled !== 1
    return { authEnabled: true, requiresSetup, setupStarted }
  },
  async setupStart(setupKey: string): Promise<{ qrDataUrl: string; manualKey: string }> {
    validateSetupKey(setupKey)
    const state = stateRow()
    if (state.totp_enabled === 1) {
      throw new Error("Authenticator already enabled.")
    }
    const secret = state.totp_secret ?? authenticator.generateSecret()
    db.prepare("UPDATE auth_state SET totp_secret = ?, updated_at = ? WHERE id = 1").run(secret, nowIso())
    const otpauthUrl = authenticator.keyuri(env.DASHBOARD_AUTH_ACCOUNT, env.DASHBOARD_AUTH_ISSUER, secret)
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl)
    return { qrDataUrl, manualKey: secret }
  },
  setupVerify(code: string): { token: string; expiresAt: string } {
    const state = stateRow()
    if (!state.totp_secret) {
      throw new Error("Setup not initialized.")
    }
    const valid = authenticator.verify({
      token: sanitizeCode(code),
      secret: state.totp_secret,
    })
    if (!valid) {
      throw new Error("Invalid authenticator code.")
    }
    db.prepare(
      "UPDATE auth_state SET totp_enabled = 1, setup_completed_at = ?, updated_at = ? WHERE id = 1"
    ).run(nowIso(), nowIso())
    return createSession()
  },
  login(code: string): { token: string; expiresAt: string } {
    const state = stateRow()
    if (state.totp_enabled !== 1 || !state.totp_secret) {
      throw new Error("Authenticator is not enabled.")
    }
    const valid = authenticator.verify({
      token: sanitizeCode(code),
      secret: state.totp_secret,
    })
    if (!valid) {
      throw new Error("Invalid authenticator code.")
    }
    return createSession()
  },
  validateSession(token: string | null): { valid: boolean; expiresAt: string | null } {
    if (!token) {
      return { valid: false, expiresAt: null }
    }
    const tokenHash = hashToken(token)
    const row = db
      .prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as { expires_at: string } | undefined
    if (!row) {
      return { valid: false, expiresAt: null }
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash)
      return { valid: false, expiresAt: null }
    }
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), tokenHash)
    return { valid: true, expiresAt: row.expires_at }
  },
  logout(token: string | null): void {
    if (!token) {
      return
    }
    db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token))
  },
}
