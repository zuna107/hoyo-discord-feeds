import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { env } from "../config/env.js"
import { schemaSql } from "./schema.js"

const ensureDbDir = (dbPath: string): void => {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

ensureDbDir(env.DB_PATH)

export const db = new Database(env.DB_PATH)
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")
db.exec(schemaSql)

const columnExists = (table: string, column: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

if (!columnExists("feeds", "language")) {
  db.exec("ALTER TABLE feeds ADD COLUMN language TEXT NOT NULL DEFAULT 'en-us'")
}
