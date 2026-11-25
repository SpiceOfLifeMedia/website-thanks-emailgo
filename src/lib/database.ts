import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type GlobalWithDatabase = typeof globalThis & { emailgoDatabase?: DatabaseSync };
const globalForDatabase = globalThis as GlobalWithDatabase;

export function getDatabase() {
  if (globalForDatabase.emailgoDatabase) return globalForDatabase.emailgoDatabase;
  const dataDirectory = process.env.EMAILGO_DATA_DIR
    ? resolve(/* turbopackIgnore: true */ process.env.EMAILGO_DATA_DIR)
    : join(process.cwd(), 'data');
  mkdirSync(dataDirectory, { recursive: true });
  const databaseName = process.env.EMAILGO_DB_FILENAME ?? 'emailgo.sqlite';
  if (!/^[a-zA-Z0-9._-]+\.sqlite$/.test(databaseName)) throw new Error('EMAILGO_DB_FILENAME must be a simple .sqlite filename.');
  const db = new DatabaseSync(join(/* turbopackIgnore: true */ dataDirectory, databaseName));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE,
      secret_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, verification_token TEXT NOT NULL,
      created_at TEXT NOT NULL, verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
      to_json TEXT NOT NULL, subject TEXT NOT NULL,
      status TEXT NOT NULL, error_message TEXT, provider_id TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS emails_created_at ON emails(created_at DESC);
    CREATE TABLE IF NOT EXISTS send_limits (api_key_id TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL, FOREIGN KEY(api_key_id) REFERENCES api_keys(id));
    CREATE TABLE IF NOT EXISTS login_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempt_count INTEGER NOT NULL);
  `);
  globalForDatabase.emailgoDatabase = db;
  return db;
}

export const nowIso = () => new Date().toISOString();
export const randomId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export function consumeSendLimit(apiKeyId: string, perMinute = 60) {
  const db = getDatabase();
  const windowStarted = Math.floor(Date.now() / 60_000);
  const row = db.prepare(`INSERT INTO send_limits(api_key_id,window_started,request_count) VALUES(?,?,1)
    ON CONFLICT(api_key_id) DO UPDATE SET window_started=excluded.window_started,
    request_count=CASE WHEN send_limits.window_started=excluded.window_started THEN send_limits.request_count+1 ELSE 1 END
    RETURNING request_count`).get(apiKeyId, windowStarted) as { request_count: number };
  return row.request_count <= perMinute;
}

export function consumeLoginAttempt(sourceHash: string, perMinute = 10) {
  const db = getDatabase();
  const windowStarted = Math.floor(Date.now() / 60_000);
  const row = db.prepare(`INSERT INTO login_limits(source_hash,window_started,attempt_count) VALUES(?,?,1)
    ON CONFLICT(source_hash) DO UPDATE SET window_started=excluded.window_started,
    attempt_count=CASE WHEN login_limits.window_started=excluded.window_started THEN login_limits.attempt_count+1 ELSE 1 END
    RETURNING attempt_count`).get(sourceHash, windowStarted) as { attempt_count: number };
  return row.attempt_count <= perMinute;
}
