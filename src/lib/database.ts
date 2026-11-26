import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { DatabaseSync } from 'node:sqlite';

type PostgresSql = NeonQueryFunction<false, true>;
type GlobalWithDatabases = typeof globalThis & {
  emailgoPostgres?: PostgresSql;
  emailgoPostgresInit?: Promise<void>;
  emailgoSqlite?: DatabaseSync;
};
const globalForDatabases = globalThis as GlobalWithDatabases;

type Statement = { sql: string; params?: readonly unknown[] };
type SqliteStatementResult<T> = T[];
type SqliteValue = null | number | bigint | string | NodeJS.ArrayBufferView;

const postgresSchema = [
  'ALTER TABLE IF EXISTS emails ADD COLUMN IF NOT EXISTS relay_message_id TEXT',
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, verification_token TEXT NOT NULL,
    created_at TEXT NOT NULL, verified_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_addresses (
    address TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT 'manual', added_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
    to_json TEXT NOT NULL, subject TEXT NOT NULL,
    status TEXT NOT NULL, error_message TEXT, provider_id TEXT, message_id TEXT, relay_message_id TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS emails_created_at ON emails(created_at DESC)',
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    api_key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    email_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(api_key_id,idempotency_key), FOREIGN KEY(api_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(email_id) REFERENCES emails(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idempotency_keys_expiry ON idempotency_keys(expires_at)',
  `CREATE TABLE IF NOT EXISTS send_limits (
    api_key_id TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS emails_relay_message_id ON emails(relay_message_id)',
  `CREATE TABLE IF NOT EXISTS delivery_events (
    id TEXT PRIMARY KEY, sns_message_id TEXT NOT NULL, email_id TEXT, relay_message_id TEXT NOT NULL,
    event_type TEXT NOT NULL, recipient TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
    UNIQUE(sns_message_id,recipient), FOREIGN KEY(email_id) REFERENCES emails(id)
  )`,
  'CREATE INDEX IF NOT EXISTS delivery_events_email ON delivery_events(email_id)',
  `CREATE TABLE IF NOT EXISTS suppressions (
    address TEXT PRIMARY KEY, reason TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
  )`,
  'CREATE TABLE IF NOT EXISTS login_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempt_count INTEGER NOT NULL)',
];

function getPostgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL.');
  if (!globalForDatabases.emailgoPostgres) {
    globalForDatabases.emailgoPostgres = neon(connectionString, { fullResults: true });
  }
  return globalForDatabases.emailgoPostgres;
}

function getSqlite() {
  if (process.env.VERCEL === '1' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for durable Vercel deployments.');
  }
  if (globalForDatabases.emailgoSqlite) return globalForDatabases.emailgoSqlite;
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
    CREATE TABLE IF NOT EXISTS blocked_addresses (
      address TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT 'manual', added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
      to_json TEXT NOT NULL, subject TEXT NOT NULL,
      status TEXT NOT NULL, error_message TEXT, provider_id TEXT, message_id TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS emails_created_at ON emails(created_at DESC);
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      api_key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      email_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(api_key_id,idempotency_key), FOREIGN KEY(api_key_id) REFERENCES api_keys(id),
      FOREIGN KEY(email_id) REFERENCES emails(id)
    );
    CREATE INDEX IF NOT EXISTS idempotency_keys_expiry ON idempotency_keys(expires_at);
    CREATE TABLE IF NOT EXISTS send_limits (
      api_key_id TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE TABLE IF NOT EXISTS delivery_events (
      id TEXT PRIMARY KEY, sns_message_id TEXT NOT NULL, email_id TEXT, relay_message_id TEXT NOT NULL,
      event_type TEXT NOT NULL, recipient TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
      UNIQUE(sns_message_id,recipient), FOREIGN KEY(email_id) REFERENCES emails(id)
    );
    CREATE INDEX IF NOT EXISTS delivery_events_email ON delivery_events(email_id);
    CREATE TABLE IF NOT EXISTS suppressions (
      address TEXT PRIMARY KEY, reason TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempt_count INTEGER NOT NULL);
  `);
  const emailColumns = db.prepare('PRAGMA table_info(emails)').all() as Array<{ name: string }>;
  if (!emailColumns.some(({ name }) => name === 'message_id')) db.exec('ALTER TABLE emails ADD COLUMN message_id TEXT');
  if (!emailColumns.some(({ name }) => name === 'relay_message_id')) db.exec('ALTER TABLE emails ADD COLUMN relay_message_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS emails_relay_message_id ON emails(relay_message_id)');
  globalForDatabases.emailgoSqlite = db;
  return db;
}

function toPostgresPlaceholders(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function ensurePostgresSchema() {
  if (!process.env.DATABASE_URL) return;
  if (!globalForDatabases.emailgoPostgresInit) {
    const sql = getPostgres();
    globalForDatabases.emailgoPostgresInit = sql.transaction(postgresSchema.map((statement) => sql.query(statement))).then(() => undefined, (error: unknown) => {
      globalForDatabases.emailgoPostgresInit = undefined;
      throw error;
    });
  }
  await globalForDatabases.emailgoPostgresInit;
}

export async function query<T extends object = Record<string, unknown>>(statement: string, params: readonly SqliteValue[] = []) {
  await ensurePostgresSchema();
  if (process.env.DATABASE_URL) {
    const result = await getPostgres().query(toPostgresPlaceholders(statement), [...params], { fullResults: true }) as { rows: T[]; rowCount: number | null };
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
  }
  const rows = getSqlite().prepare(statement).all(...params) as SqliteStatementResult<T>;
  return { rows, rowCount: rows.length };
}

export async function queryOne<T extends object = Record<string, unknown>>(statement: string, params: readonly SqliteValue[] = []) {
  const result = await query<T>(statement, params);
  return result.rows[0];
}

export async function execute(statement: string, params: readonly SqliteValue[] = []) {
  await ensurePostgresSchema();
  if (process.env.DATABASE_URL) {
    const result = await getPostgres().query(toPostgresPlaceholders(statement), [...params], { fullResults: true }) as { rowCount: number | null };
    return result.rowCount ?? 0;
  }
  return getSqlite().prepare(statement).run(...params).changes;
}

export async function transaction(statements: readonly Statement[]) {
  await ensurePostgresSchema();
  if (process.env.DATABASE_URL) {
    const sql = getPostgres();
    await sql.transaction(statements.map(({ sql: statement, params = [] }) => sql.query(toPostgresPlaceholders(statement), [...params] as unknown[])));
    return;
  }
  const db = getSqlite();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { sql, params = [] } of statements) db.prepare(sql).run(...params as SqliteValue[]);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const nowIso = () => new Date().toISOString();
export const randomId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

async function consumeLimit(statement: string, key: string, perMinute: number) {
  const windowStarted = Math.floor(Date.now() / 60_000);
  const result = await query<{ request_count?: number; attempt_count?: number }>(statement, [key, windowStarted]);
  const count = result.rows[0]?.request_count ?? result.rows[0]?.attempt_count ?? 0;
  return count <= perMinute;
}

export function consumeSendLimit(apiKeyId: string, perMinute = 60) {
  return consumeLimit(`INSERT INTO send_limits(api_key_id,window_started,request_count) VALUES(?,?,1)
    ON CONFLICT(api_key_id) DO UPDATE SET window_started=excluded.window_started,
    request_count=CASE WHEN send_limits.window_started=excluded.window_started THEN send_limits.request_count+1 ELSE 1 END
    RETURNING request_count`, apiKeyId, perMinute);
}

export function consumeWebhookLimit(sourceHash: string, perMinute = 600) {
  return consumeLimit(`INSERT INTO login_limits(source_hash,window_started,attempt_count) VALUES(?,?,1)
    ON CONFLICT(source_hash) DO UPDATE SET window_started=excluded.window_started,
    attempt_count=CASE WHEN login_limits.window_started=excluded.window_started THEN login_limits.attempt_count+1 ELSE 1 END
    RETURNING attempt_count`, `webhook:${sourceHash}`, perMinute);
}

export function consumeLoginAttempt(sourceHash: string, perMinute = 10) {
  return consumeLimit(`INSERT INTO login_limits(source_hash,window_started,attempt_count) VALUES(?,?,1)
    ON CONFLICT(source_hash) DO UPDATE SET window_started=excluded.window_started,
    attempt_count=CASE WHEN login_limits.window_started=excluded.window_started THEN login_limits.attempt_count+1 ELSE 1 END
    RETURNING attempt_count`, sourceHash, perMinute);
}
