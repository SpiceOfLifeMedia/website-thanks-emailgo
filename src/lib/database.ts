import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { DatabaseSync } from 'node:sqlite';
import { API_RATE_LIMIT_WINDOW_MS, apiRateLimitState } from './rate-limit.ts';

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
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
    permission TEXT NOT NULL DEFAULT 'full_access', domain_id TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_request_logs (
    id TEXT PRIMARY KEY, api_key_id TEXT, api_key_name TEXT, api_key_prefix TEXT,
    endpoint TEXT NOT NULL, method TEXT NOT NULL, response_status INTEGER NOT NULL,
    user_agent TEXT, request_bytes INTEGER, response_bytes INTEGER,
    request_body_json TEXT, response_body_json TEXT,
    created_at TEXT NOT NULL
  )`,
  'ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS api_key_name TEXT',
  'ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS api_key_prefix TEXT',
  'ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS request_bytes INTEGER',
  'ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS response_bytes INTEGER',
  'CREATE INDEX IF NOT EXISTS api_request_logs_created_at ON api_request_logs(created_at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS api_request_logs_status_created_at ON api_request_logs(response_status,created_at DESC,id DESC)',
  "ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'full_access'",
  'ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS domain_id TEXT',
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, endpoint TEXT NOT NULL,
    events_json TEXT NOT NULL, secret_generation INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS webhooks_api_key ON webhooks(api_key_id,created_at DESC)',
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, webhook_id TEXT NOT NULL, api_key_id TEXT NOT NULL,
    event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, next_attempt_at TEXT,
    last_attempt_at TEXT, last_status_code INTEGER, last_response_excerpt TEXT, last_error TEXT,
    processing_started_at TEXT, delivered_at TEXT,
    FOREIGN KEY(webhook_id) REFERENCES webhooks(id), FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS webhook_deliveries_queue ON webhook_deliveries(status,next_attempt_at,created_at)',
  'CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook ON webhook_deliveries(webhook_id,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS webhook_deliveries_event ON webhook_deliveries(event_id)',
  `CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
    id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
    attempted_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, status_code INTEGER,
    response_excerpt TEXT, error_message TEXT,
    FOREIGN KEY(delivery_id) REFERENCES webhook_deliveries(id)
  )`,
  'CREATE INDEX IF NOT EXISTS webhook_delivery_attempts_delivery ON webhook_delivery_attempts(delivery_id,attempt_number DESC)',
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, verification_token TEXT NOT NULL,
    created_at TEXT NOT NULL, verified_at TEXT,
    open_tracking INTEGER NOT NULL DEFAULT 0, click_tracking INTEGER NOT NULL DEFAULT 0
  )`,
  'ALTER TABLE domains ADD COLUMN IF NOT EXISTS open_tracking INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE domains ADD COLUMN IF NOT EXISTS click_tracking INTEGER NOT NULL DEFAULT 0',
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
    to_json TEXT NOT NULL, subject TEXT NOT NULL,
    status TEXT NOT NULL, error_message TEXT, provider_id TEXT, message_id TEXT, relay_message_id TEXT, created_at TEXT NOT NULL,
    cc_json TEXT, bcc_json TEXT, reply_to TEXT, headers_json TEXT, tags_json TEXT, attachments_json TEXT,
    text_body TEXT, html_body TEXT, attachment_payload_json TEXT, scheduled_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, processing_started_at TEXT,
    track_opens INTEGER NOT NULL DEFAULT 0, track_clicks INTEGER NOT NULL DEFAULT 0, broadcast_id TEXT, thread_id TEXT,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS relay_message_id TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS cc_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS bcc_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS reply_to TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS headers_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS tags_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachments_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS text_body TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS html_body TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_payload_json TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_at TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS next_attempt_at TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS processing_started_at TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS track_opens INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS track_clicks INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS broadcast_id TEXT',
  'ALTER TABLE emails ADD COLUMN IF NOT EXISTS thread_id TEXT',
  `CREATE TABLE IF NOT EXISTS broadcast_folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS broadcast_folders_name_lower_unique ON broadcast_folders(LOWER(name))',
  `CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
    subject TEXT NOT NULL, text_body TEXT, html_body TEXT, editor_json TEXT, reply_to TEXT, preview_text TEXT,
    audience_type TEXT NOT NULL, audience_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', folder_id TEXT,
    scheduled_at TEXT, recipient_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(folder_id) REFERENCES broadcast_folders(id) ON DELETE SET NULL
  )`,
  'ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS editor_json TEXT',
  'ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS reply_to TEXT',
  'ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS preview_text TEXT',
  'ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES broadcast_folders(id) ON DELETE SET NULL',
  'CREATE INDEX IF NOT EXISTS broadcasts_updated_at ON broadcasts(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS broadcasts_folder_updated_at ON broadcasts(folder_id,updated_at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS emails_broadcast_id ON emails(broadcast_id,created_at DESC)',
  `CREATE TABLE IF NOT EXISTS received_emails (
    id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL UNIQUE, api_key_id TEXT NOT NULL,
    message_id TEXT, from_address TEXT NOT NULL, to_json TEXT NOT NULL, cc_json TEXT, bcc_json TEXT,
    subject TEXT NOT NULL, headers_json TEXT, text_body TEXT, html_body TEXT, thread_id TEXT,
    received_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS received_emails_api_key ON received_emails(api_key_id,received_at DESC,id DESC)',
  'ALTER TABLE received_emails ADD COLUMN IF NOT EXISTS thread_id TEXT',
  `CREATE TABLE IF NOT EXISTS inbox_threads (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, subject TEXT NOT NULL,
    inbox_address TEXT,
    folder TEXT NOT NULL DEFAULT 'inbox', is_read INTEGER NOT NULL DEFAULT 0,
    labels_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'ALTER TABLE inbox_threads ADD COLUMN IF NOT EXISTS inbox_address TEXT',
  'CREATE INDEX IF NOT EXISTS inbox_threads_key_folder_updated ON inbox_threads(api_key_id,folder,updated_at DESC,id DESC)',
  `CREATE TABLE IF NOT EXISTS inbox_reply_drafts (
    thread_id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'reply', from_address TEXT NOT NULL,
    to_text TEXT NOT NULL DEFAULT '', cc_text TEXT NOT NULL DEFAULT '', bcc_text TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '', text_body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    FOREIGN KEY(thread_id) REFERENCES inbox_threads(id) ON DELETE CASCADE,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'ALTER TABLE inbox_reply_drafts ADD COLUMN IF NOT EXISTS from_address TEXT NOT NULL DEFAULT \'\'',
  'CREATE INDEX IF NOT EXISTS inbox_reply_drafts_updated ON inbox_reply_drafts(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS received_emails_thread ON received_emails(api_key_id,thread_id,received_at,id)',
  'CREATE INDEX IF NOT EXISTS emails_thread ON emails(api_key_id,thread_id,created_at,id)',
  `CREATE TABLE IF NOT EXISTS received_email_attachments (
    id TEXT PRIMARY KEY, received_email_id TEXT NOT NULL, filename TEXT NOT NULL,
    content_type TEXT NOT NULL, content_disposition TEXT, content_id TEXT,
    byte_length INTEGER NOT NULL, content_base64 TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(received_email_id) REFERENCES received_emails(id)
  )`,
  'CREATE INDEX IF NOT EXISTS received_attachments_email ON received_email_attachments(received_email_id,created_at,id)',
  `CREATE TABLE IF NOT EXISTS email_share_links (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, api_key_id TEXT NOT NULL,
    email_id TEXT NOT NULL, email_type TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, revoked_at TEXT,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS email_share_links_owner_email ON email_share_links(api_key_id,email_type,email_id,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS emails_created_at ON emails(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS emails_status_created_at ON emails(status,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS emails_relay_message_id ON emails(relay_message_id)',
  'CREATE INDEX IF NOT EXISTS emails_api_key_created_at ON emails(api_key_id,created_at DESC,id DESC)',
  'CREATE INDEX IF NOT EXISTS emails_scheduled_queue ON emails(status,scheduled_at,next_attempt_at)',
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
  'CREATE TABLE IF NOT EXISTS api_request_limits (workspace_id TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS login_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempt_count INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS webhook_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS email_template_folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(parent_id) REFERENCES email_template_folders(id) ON DELETE CASCADE
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS email_template_folders_child_name ON email_template_folders(parent_id,name) WHERE parent_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS email_template_folders_root_name ON email_template_folders(name) WHERE parent_id IS NULL',
  `CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, alias TEXT, from_address TEXT,
    folder_id TEXT REFERENCES email_template_folders(id) ON DELETE SET NULL,
    subject TEXT NOT NULL DEFAULT '', reply_to TEXT, html TEXT, text TEXT,
    variables_json TEXT NOT NULL DEFAULT '[]', editor_json TEXT, current_version_id TEXT, published_version_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft', published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES email_template_folders(id) ON DELETE SET NULL',
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS alias TEXT',
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS from_address TEXT',
  "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS reply_to TEXT',
  "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS variables_json TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS editor_json TEXT',
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS current_version_id TEXT',
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS published_version_id TEXT',
  "ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'",
  'ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS published_at TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS email_templates_alias_unique ON email_templates(alias) WHERE alias IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS email_templates_updated_at ON email_templates(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS email_templates_folder_updated_at ON email_templates(folder_id,updated_at DESC,id DESC)',
  `CREATE TABLE IF NOT EXISTS email_template_versions (
    id TEXT PRIMARY KEY, template_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL, published_at TEXT,
    FOREIGN KEY(template_id) REFERENCES email_templates(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS email_template_versions_template ON email_template_versions(template_id,created_at DESC,id DESC)',
  `INSERT INTO email_template_versions(id,template_id,snapshot_json,created_at,published_at)
    SELECT 'tplv_' || md5(id || ':legacy-template:v1'),id,
      json_build_object('name',name,'alias',alias,'from',from_address,'subject',subject,'reply_to',reply_to,'html',COALESCE(html,''),'text',text,'variables','[]'::json)::text,
      updated_at,updated_at
    FROM email_templates WHERE current_version_id IS NULL
    ON CONFLICT (id) DO NOTHING`,
  `UPDATE email_templates SET current_version_id='tplv_' || md5(id || ':legacy-template:v1'),
    published_version_id='tplv_' || md5(id || ':legacy-template:v1'),status='published',published_at=COALESCE(published_at,updated_at)
    WHERE current_version_id IS NULL`,
  `CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    trigger_event TEXT NOT NULL, steps_json TEXT NOT NULL, connections_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'CREATE INDEX IF NOT EXISTS automations_key_status ON automations(api_key_id,status,updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS automation_template_refs (
    automation_id TEXT NOT NULL, template_id TEXT NOT NULL,
    PRIMARY KEY(automation_id,template_id),
    FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE,
    FOREIGN KEY(template_id) REFERENCES email_templates(id) ON DELETE RESTRICT
  )`,
  `INSERT INTO automation_template_refs(automation_id,template_id)
    SELECT a.id,step.value #>> '{config,template,id}'
    FROM automations a CROSS JOIN LATERAL jsonb_array_elements(a.steps_json::jsonb) AS step(value)
    JOIN email_templates t ON t.id=(step.value #>> '{config,template,id}')
    WHERE step.value->>'type'='send_email'
    ON CONFLICT (automation_id,template_id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS custom_event_schemas (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, name TEXT NOT NULL, schema_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(api_key_id,name), FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS custom_event_schemas_key_updated ON custom_event_schemas(api_key_id,updated_at DESC,id DESC)',
  `CREATE TABLE IF NOT EXISTS automation_events (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, event_name TEXT NOT NULL, contact_id TEXT, email TEXT,
    payload_json TEXT NOT NULL, idempotency_key TEXT, request_hash TEXT, created_at TEXT NOT NULL,
    UNIQUE(api_key_id,idempotency_key), FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
  )`,
  'ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS request_hash TEXT',
  'CREATE INDEX IF NOT EXISTS automation_events_lookup ON automation_events(api_key_id,event_name,created_at DESC)',
  `CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, api_key_id TEXT NOT NULL, event_id TEXT NOT NULL,
    event_name TEXT NOT NULL, contact_id TEXT, email TEXT, payload_json TEXT NOT NULL,
    steps_json TEXT NOT NULL, connections_json TEXT NOT NULL, current_step_key TEXT,
    status TEXT NOT NULL DEFAULT 'running', waiting_event_name TEXT, waiting_since TEXT, resume_at TEXT,
    context_json TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
    processing_started_at TEXT, error TEXT,
    UNIQUE(automation_id,event_id), FOREIGN KEY(automation_id) REFERENCES automations(id),
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id), FOREIGN KEY(event_id) REFERENCES automation_events(id)
  )`,
  'CREATE INDEX IF NOT EXISTS automation_runs_queue ON automation_runs(status,resume_at,updated_at)',
  'CREATE INDEX IF NOT EXISTS automation_runs_automation ON automation_runs(automation_id,started_at DESC)',
  `CREATE TABLE IF NOT EXISTS automation_run_steps (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_key TEXT NOT NULL, step_type TEXT NOT NULL,
    status TEXT NOT NULL, input_json TEXT, output_json TEXT, started_at TEXT NOT NULL,
    finished_at TEXT, error TEXT, UNIQUE(run_id,step_key), FOREIGN KEY(run_id) REFERENCES automation_runs(id)
  )`,
  'CREATE INDEX IF NOT EXISTS automation_run_steps_run ON automation_run_steps(run_id,started_at)',
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
    properties_json TEXT NOT NULL, tags_json TEXT NOT NULL, unsubscribed_at TEXT,
    consent_status TEXT NOT NULL DEFAULT 'unknown', consent_source TEXT, consented_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_imports (
    id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, status TEXT NOT NULL,
    counts_json TEXT NOT NULL, errors_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
    FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS contact_imports_key_created ON contact_imports(api_key_id,created_at DESC,id DESC)',
  `CREATE TABLE IF NOT EXISTS contact_properties (
    property_key TEXT PRIMARY KEY, type TEXT NOT NULL, fallback_value_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS suppressions (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, normalized_email TEXT NOT NULL UNIQUE,
    origin TEXT NOT NULL DEFAULT 'manual', source_id TEXT, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS suppressions_created_at ON suppressions(created_at DESC,id DESC)',
  'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_status TEXT NOT NULL DEFAULT \'unknown\'',
  'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_source TEXT',
  'ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consented_at TEXT',
  `CREATE TABLE IF NOT EXISTS email_events (
    id TEXT PRIMARY KEY, email_id TEXT NOT NULL, type TEXT NOT NULL,
    created_at TEXT NOT NULL, target_domain TEXT, target_path TEXT,
    FOREIGN KEY(email_id) REFERENCES emails(id)
  )`,
  `CREATE TABLE IF NOT EXISTS delivery_events (
    id TEXT PRIMARY KEY, sns_message_id TEXT NOT NULL, email_id TEXT, relay_message_id TEXT NOT NULL,
    event_type TEXT NOT NULL, recipient TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
    UNIQUE(sns_message_id,recipient), FOREIGN KEY(email_id) REFERENCES emails(id)
  )`,
  'CREATE INDEX IF NOT EXISTS delivery_events_email ON delivery_events(email_id)',
  'CREATE INDEX IF NOT EXISTS delivery_events_recipient_type_created ON delivery_events(LOWER(recipient),event_type,created_at DESC)',
  'ALTER TABLE email_events ADD COLUMN IF NOT EXISTS target_url TEXT',
  'CREATE INDEX IF NOT EXISTS email_events_email ON email_events(email_id,created_at DESC)',
  'CREATE INDEX IF NOT EXISTS email_events_email_type_created ON email_events(email_id,type,created_at,id)',
  'CREATE INDEX IF NOT EXISTS email_events_type_created_email ON email_events(type,created_at DESC,email_id)',
  'CREATE INDEX IF NOT EXISTS contacts_created_at ON contacts(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS contacts_updated_at ON contacts(updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS segments_updated_at ON segments(updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS segment_contacts (
    segment_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(segment_id,contact_id),
    FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE,
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS segment_contacts_contact ON segment_contacts(contact_id,segment_id)',
  `CREATE TABLE IF NOT EXISTS segment_contact_exclusions (
    segment_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(segment_id,contact_id),
    FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE,
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS segment_contact_exclusions_contact ON segment_contact_exclusions(contact_id,segment_id)',
  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, description TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT
  )`,
  'ALTER TABLE topics ADD COLUMN IF NOT EXISTS disabled_at TEXT',
  'CREATE INDEX IF NOT EXISTS topics_updated_at ON topics(updated_at DESC)',
  `CREATE TABLE IF NOT EXISTS contact_topics (
    contact_id TEXT NOT NULL, topic_id TEXT NOT NULL, subscribed_at TEXT, unsubscribed_at TEXT,
    consent_source TEXT, consented_at TEXT, PRIMARY KEY(contact_id,topic_id),
    FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS contact_topics_topic ON contact_topics(topic_id,subscribed_at DESC)',
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
      permission TEXT NOT NULL DEFAULT 'full_access', domain_id TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS api_request_logs (
      id TEXT PRIMARY KEY, api_key_id TEXT, api_key_name TEXT, api_key_prefix TEXT,
      endpoint TEXT NOT NULL, method TEXT NOT NULL, response_status INTEGER NOT NULL,
      user_agent TEXT, request_bytes INTEGER, response_bytes INTEGER,
      request_body_json TEXT, response_body_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_request_logs_created_at ON api_request_logs(created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS api_request_logs_status_created_at ON api_request_logs(response_status,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, endpoint TEXT NOT NULL,
      events_json TEXT NOT NULL, secret_generation INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS webhooks_api_key ON webhooks(api_key_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, webhook_id TEXT NOT NULL, api_key_id TEXT NOT NULL,
      event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, next_attempt_at TEXT,
      last_attempt_at TEXT, last_status_code INTEGER, last_response_excerpt TEXT, last_error TEXT,
      processing_started_at TEXT, delivered_at TEXT,
      FOREIGN KEY(webhook_id) REFERENCES webhooks(id), FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_queue ON webhook_deliveries(status,next_attempt_at,created_at);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook ON webhook_deliveries(webhook_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_event ON webhook_deliveries(event_id);
    CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
      id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, attempt_number INTEGER NOT NULL,
      attempted_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, status_code INTEGER,
      response_excerpt TEXT, error_message TEXT,
      FOREIGN KEY(delivery_id) REFERENCES webhook_deliveries(id)
    );
    CREATE INDEX IF NOT EXISTS webhook_delivery_attempts_delivery ON webhook_delivery_attempts(delivery_id,attempt_number DESC);
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, verification_token TEXT NOT NULL,
      created_at TEXT NOT NULL, verified_at TEXT,
      open_tracking INTEGER NOT NULL DEFAULT 0, click_tracking INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
      to_json TEXT NOT NULL, subject TEXT NOT NULL,
      status TEXT NOT NULL, error_message TEXT, provider_id TEXT, message_id TEXT, relay_message_id TEXT, created_at TEXT NOT NULL,
      cc_json TEXT, bcc_json TEXT, reply_to TEXT, headers_json TEXT, tags_json TEXT, attachments_json TEXT,
      text_body TEXT, html_body TEXT, attachment_payload_json TEXT, scheduled_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, processing_started_at TEXT,
      track_opens INTEGER NOT NULL DEFAULT 0, track_clicks INTEGER NOT NULL DEFAULT 0, broadcast_id TEXT, thread_id TEXT,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE TABLE IF NOT EXISTS broadcast_folders (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS broadcast_folders_name_lower_unique ON broadcast_folders(LOWER(name));
    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_id TEXT NOT NULL, from_address TEXT NOT NULL,
      subject TEXT NOT NULL, text_body TEXT, html_body TEXT, editor_json TEXT, reply_to TEXT, preview_text TEXT,
      audience_type TEXT NOT NULL, audience_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', folder_id TEXT REFERENCES broadcast_folders(id) ON DELETE SET NULL,
      scheduled_at TEXT, recipient_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS broadcasts_updated_at ON broadcasts(updated_at DESC);
    CREATE INDEX IF NOT EXISTS broadcasts_folder_updated_at ON broadcasts(folder_id,updated_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS received_emails (
      id TEXT PRIMARY KEY, provider_event_id TEXT NOT NULL UNIQUE, api_key_id TEXT NOT NULL,
      message_id TEXT, from_address TEXT NOT NULL, to_json TEXT NOT NULL, cc_json TEXT, bcc_json TEXT,
      subject TEXT NOT NULL, headers_json TEXT, text_body TEXT, html_body TEXT,
      received_at TEXT NOT NULL, created_at TEXT NOT NULL, thread_id TEXT,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS received_emails_api_key ON received_emails(api_key_id,received_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS inbox_threads (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, subject TEXT NOT NULL,
      inbox_address TEXT,
      folder TEXT NOT NULL DEFAULT 'inbox', is_read INTEGER NOT NULL DEFAULT 0,
      labels_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS inbox_threads_key_folder_updated ON inbox_threads(api_key_id,folder,updated_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS inbox_reply_drafts (
      thread_id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'reply', from_address TEXT NOT NULL,
      to_text TEXT NOT NULL DEFAULT '', cc_text TEXT NOT NULL DEFAULT '', bcc_text TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '', text_body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES inbox_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS inbox_reply_drafts_updated ON inbox_reply_drafts(updated_at DESC);
    CREATE TABLE IF NOT EXISTS received_email_attachments (
      id TEXT PRIMARY KEY, received_email_id TEXT NOT NULL, filename TEXT NOT NULL,
      content_type TEXT NOT NULL, content_disposition TEXT, content_id TEXT,
      byte_length INTEGER NOT NULL, content_base64 TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(received_email_id) REFERENCES received_emails(id)
    );
    CREATE INDEX IF NOT EXISTS received_attachments_email ON received_email_attachments(received_email_id,created_at,id);
    CREATE TABLE IF NOT EXISTS email_share_links (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, api_key_id TEXT NOT NULL,
      email_id TEXT NOT NULL, email_type TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, revoked_at TEXT,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS email_share_links_owner_email ON email_share_links(api_key_id,email_type,email_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS emails_created_at ON emails(created_at DESC);
    CREATE INDEX IF NOT EXISTS emails_status_created_at ON emails(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS emails_api_key_created_at ON emails(api_key_id,created_at DESC,id DESC);
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
    CREATE TABLE IF NOT EXISTS api_request_limits (workspace_id TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempt_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_limits (source_hash TEXT PRIMARY KEY, window_started INTEGER NOT NULL, request_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_template_folders (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES email_template_folders(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS email_template_folders_child_name ON email_template_folders(parent_id,name) WHERE parent_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS email_template_folders_root_name ON email_template_folders(name) WHERE parent_id IS NULL;
    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, alias TEXT, from_address TEXT,
      subject TEXT NOT NULL DEFAULT '', reply_to TEXT, html TEXT, text TEXT,
      variables_json TEXT NOT NULL DEFAULT '[]', editor_json TEXT, current_version_id TEXT, published_version_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft', published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_templates_updated_at ON email_templates(updated_at DESC);
    CREATE TABLE IF NOT EXISTS email_template_versions (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL, published_at TEXT,
      FOREIGN KEY(template_id) REFERENCES email_templates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS email_template_versions_template ON email_template_versions(template_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      trigger_event TEXT NOT NULL, steps_json TEXT NOT NULL, connections_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS automations_key_status ON automations(api_key_id,status,updated_at DESC);
    CREATE TABLE IF NOT EXISTS automation_template_refs (
      automation_id TEXT NOT NULL, template_id TEXT NOT NULL,
      PRIMARY KEY(automation_id,template_id),
      FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY(template_id) REFERENCES email_templates(id) ON DELETE RESTRICT
    );
    INSERT OR IGNORE INTO automation_template_refs(automation_id,template_id)
      SELECT a.id,json_extract(step.value,'$.config.template.id')
      FROM automations a,json_each(CASE WHEN json_valid(a.steps_json) THEN a.steps_json ELSE '[]' END) AS step
      JOIN email_templates t ON t.id=json_extract(step.value,'$.config.template.id')
      WHERE json_extract(step.value,'$.type')='send_email';
    CREATE TABLE IF NOT EXISTS custom_event_schemas (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, name TEXT NOT NULL, schema_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(api_key_id,name), FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS custom_event_schemas_key_updated ON custom_event_schemas(api_key_id,updated_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS automation_events (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, event_name TEXT NOT NULL, contact_id TEXT, email TEXT,
      payload_json TEXT NOT NULL, idempotency_key TEXT, request_hash TEXT, created_at TEXT NOT NULL,
      UNIQUE(api_key_id,idempotency_key), FOREIGN KEY(api_key_id) REFERENCES api_keys(id)
    );
    CREATE INDEX IF NOT EXISTS automation_events_lookup ON automation_events(api_key_id,event_name,created_at DESC);
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, api_key_id TEXT NOT NULL, event_id TEXT NOT NULL,
      event_name TEXT NOT NULL, contact_id TEXT, email TEXT, payload_json TEXT NOT NULL,
      steps_json TEXT NOT NULL, connections_json TEXT NOT NULL, current_step_key TEXT,
      status TEXT NOT NULL DEFAULT 'running', waiting_event_name TEXT, waiting_since TEXT, resume_at TEXT,
      context_json TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      processing_started_at TEXT, error TEXT,
      UNIQUE(automation_id,event_id), FOREIGN KEY(automation_id) REFERENCES automations(id),
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id), FOREIGN KEY(event_id) REFERENCES automation_events(id)
    );
    CREATE INDEX IF NOT EXISTS automation_runs_queue ON automation_runs(status,resume_at,updated_at);
    CREATE INDEX IF NOT EXISTS automation_runs_automation ON automation_runs(automation_id,started_at DESC);
    CREATE TABLE IF NOT EXISTS automation_run_steps (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_key TEXT NOT NULL, step_type TEXT NOT NULL,
      status TEXT NOT NULL, input_json TEXT, output_json TEXT, started_at TEXT NOT NULL,
      finished_at TEXT, error TEXT, UNIQUE(run_id,step_key), FOREIGN KEY(run_id) REFERENCES automation_runs(id)
    );
    CREATE INDEX IF NOT EXISTS automation_run_steps_run ON automation_run_steps(run_id,started_at);
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
      properties_json TEXT NOT NULL, tags_json TEXT NOT NULL, unsubscribed_at TEXT,
      consent_status TEXT NOT NULL DEFAULT 'unknown', consent_source TEXT, consented_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_imports (
      id TEXT PRIMARY KEY, api_key_id TEXT NOT NULL, status TEXT NOT NULL,
      counts_json TEXT NOT NULL, errors_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS contact_imports_key_created ON contact_imports(api_key_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS contact_properties (
      property_key TEXT PRIMARY KEY, type TEXT NOT NULL, fallback_value_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppressions (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, normalized_email TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL DEFAULT 'manual', source_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS suppressions_created_at ON suppressions(created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS email_events (
      id TEXT PRIMARY KEY, email_id TEXT NOT NULL, type TEXT NOT NULL,
      created_at TEXT NOT NULL, target_domain TEXT, target_path TEXT,
      FOREIGN KEY(email_id) REFERENCES emails(id)
    );
    CREATE TABLE IF NOT EXISTS delivery_events (
      id TEXT PRIMARY KEY, sns_message_id TEXT NOT NULL, email_id TEXT, relay_message_id TEXT NOT NULL,
      event_type TEXT NOT NULL, recipient TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL,
      UNIQUE(sns_message_id,recipient), FOREIGN KEY(email_id) REFERENCES emails(id)
    );
    CREATE INDEX IF NOT EXISTS delivery_events_email ON delivery_events(email_id);
    CREATE INDEX IF NOT EXISTS delivery_events_recipient_type_created ON delivery_events(LOWER(recipient),event_type,created_at DESC);
    CREATE INDEX IF NOT EXISTS email_events_email ON email_events(email_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS email_events_email_type_created ON email_events(email_id,type,created_at,id);
    CREATE INDEX IF NOT EXISTS email_events_type_created_email ON email_events(type,created_at DESC,email_id);
    CREATE INDEX IF NOT EXISTS contacts_created_at ON contacts(created_at DESC);
    CREATE INDEX IF NOT EXISTS contacts_updated_at ON contacts(updated_at DESC);
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS segments_updated_at ON segments(updated_at DESC);
    CREATE TABLE IF NOT EXISTS segment_contacts (
      segment_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(segment_id,contact_id),
      FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE,
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS segment_contacts_contact ON segment_contacts(contact_id,segment_id);
    CREATE TABLE IF NOT EXISTS segment_contact_exclusions (
      segment_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(segment_id,contact_id),
      FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE,
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS segment_contact_exclusions_contact ON segment_contact_exclusions(contact_id,segment_id);
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, description TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS topics_updated_at ON topics(updated_at DESC);
    CREATE TABLE IF NOT EXISTS contact_topics (
      contact_id TEXT NOT NULL, topic_id TEXT NOT NULL, subscribed_at TEXT, unsubscribed_at TEXT,
      consent_source TEXT, consented_at TEXT, PRIMARY KEY(contact_id,topic_id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS contact_topics_topic ON contact_topics(topic_id,subscribed_at DESC);
  `);
  const emailColumns = db.prepare('PRAGMA table_info(emails)').all() as Array<{ name: string }>;
  const existingEmailColumns = new Set(emailColumns.map(({ name }) => name));
  const emailMigrations: Array<[string, string]> = [
    ['message_id', 'TEXT'], ['relay_message_id', 'TEXT'], ['cc_json', 'TEXT'], ['bcc_json', 'TEXT'], ['reply_to', 'TEXT'],
    ['headers_json', 'TEXT'], ['tags_json', 'TEXT'], ['attachments_json', 'TEXT'], ['text_body', 'TEXT'],
    ['html_body', 'TEXT'], ['attachment_payload_json', 'TEXT'], ['scheduled_at', 'TEXT'],
    ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'], ['next_attempt_at', 'TEXT'], ['processing_started_at', 'TEXT'],
    ['track_opens', 'INTEGER NOT NULL DEFAULT 0'], ['track_clicks', 'INTEGER NOT NULL DEFAULT 0'],
    ['broadcast_id', 'TEXT'], ['thread_id', 'TEXT'],
  ];
  for (const [column, definition] of emailMigrations) {
    if (!existingEmailColumns.has(column)) db.exec(`ALTER TABLE emails ADD COLUMN ${column} ${definition}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS emails_relay_message_id ON emails(relay_message_id)');
  db.exec('CREATE INDEX IF NOT EXISTS emails_thread ON emails(api_key_id,thread_id,created_at,id)');
  const receivedColumns = db.prepare('PRAGMA table_info(received_emails)').all() as Array<{ name: string }>;
  if (!receivedColumns.some(({ name }) => name === 'thread_id')) db.exec('ALTER TABLE received_emails ADD COLUMN thread_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS received_emails_thread ON received_emails(api_key_id,thread_id,received_at,id)');
  const inboxThreadColumns = db.prepare('PRAGMA table_info(inbox_threads)').all() as Array<{ name: string }>;
  if (!inboxThreadColumns.some(({ name }) => name === 'inbox_address')) db.exec('ALTER TABLE inbox_threads ADD COLUMN inbox_address TEXT');
  const inboxDraftColumns = db.prepare('PRAGMA table_info(inbox_reply_drafts)').all() as Array<{ name: string }>;
  if (!inboxDraftColumns.some(({ name }) => name === 'from_address')) db.exec("ALTER TABLE inbox_reply_drafts ADD COLUMN from_address TEXT NOT NULL DEFAULT ''");
  const broadcastColumns = db.prepare('PRAGMA table_info(broadcasts)').all() as Array<{ name: string }>;
  if (!broadcastColumns.some(({ name }) => name === 'editor_json')) db.exec('ALTER TABLE broadcasts ADD COLUMN editor_json TEXT');
  if (!broadcastColumns.some(({ name }) => name === 'folder_id')) db.exec('ALTER TABLE broadcasts ADD COLUMN folder_id TEXT REFERENCES broadcast_folders(id) ON DELETE SET NULL');
  if (!broadcastColumns.some(({ name }) => name === 'reply_to')) db.exec('ALTER TABLE broadcasts ADD COLUMN reply_to TEXT');
  if (!broadcastColumns.some(({ name }) => name === 'preview_text')) db.exec('ALTER TABLE broadcasts ADD COLUMN preview_text TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS broadcast_folders_name_lower_unique ON broadcast_folders(LOWER(name))');
  db.exec('CREATE INDEX IF NOT EXISTS broadcasts_folder_updated_at ON broadcasts(folder_id,updated_at DESC,id DESC)');
  const templateColumns = db.prepare('PRAGMA table_info(email_templates)').all() as Array<{ name: string }>;
  const existingTemplateColumns = new Set(templateColumns.map(({ name }) => name));
  for (const [column, definition] of [
    ['alias', 'TEXT'], ['from_address', 'TEXT'], ['folder_id', 'TEXT REFERENCES email_template_folders(id) ON DELETE SET NULL'], ['reply_to', 'TEXT'],
    ['variables_json', "TEXT NOT NULL DEFAULT '[]'"], ['editor_json', 'TEXT'], ['current_version_id', 'TEXT'],
    ['published_version_id', 'TEXT'], ["status", "TEXT NOT NULL DEFAULT 'draft'"], ['published_at', 'TEXT'],
  ] as const) {
    if (!existingTemplateColumns.has(column)) db.exec(`ALTER TABLE email_templates ADD COLUMN ${column} ${definition}`);
  }
  const legacyTemplates = db.prepare(`SELECT id,name,alias,from_address,subject,reply_to,html,text,updated_at FROM email_templates WHERE current_version_id IS NULL`).all() as Array<{
    id: string; name: string; alias: string | null; from_address: string | null; subject: string; reply_to: string | null; html: string | null; text: string | null; updated_at: string;
  }>;
  if (legacyTemplates.length) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const insertVersion = db.prepare('INSERT INTO email_template_versions(id,template_id,snapshot_json,created_at,published_at) VALUES(?,?,?,?,?)');
      const updateTemplate = db.prepare(`UPDATE email_templates SET current_version_id=?,published_version_id=?,status='published',published_at=COALESCE(published_at,updated_at) WHERE id=? AND current_version_id IS NULL`);
      for (const template of legacyTemplates) {
        const versionId = `tplv_${createHash('md5').update(`${template.id}:legacy-template:v1`).digest('hex')}`;
        insertVersion.run(versionId, template.id, JSON.stringify({ name: template.name, alias: template.alias, from: template.from_address, subject: template.subject, reply_to: template.reply_to, html: template.html ?? '', text: template.text, variables: [] }), template.updated_at, template.updated_at);
        updateTemplate.run(versionId, versionId, template.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS email_templates_alias_unique ON email_templates(alias) WHERE alias IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS email_templates_folder_updated_at ON email_templates(folder_id,updated_at DESC,id DESC)');
  const keyColumns = db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>;
  const existingKeyColumns = new Set(keyColumns.map(({ name }) => name));
  if (!existingKeyColumns.has('permission')) db.exec("ALTER TABLE api_keys ADD COLUMN permission TEXT NOT NULL DEFAULT 'full_access'");
  if (!existingKeyColumns.has('domain_id')) db.exec('ALTER TABLE api_keys ADD COLUMN domain_id TEXT');
  const requestLogColumns = db.prepare('PRAGMA table_info(api_request_logs)').all() as Array<{ name: string }>;
  const existingRequestLogColumns = new Set(requestLogColumns.map(({ name }) => name));
  for (const [column, definition] of [
    ['api_key_name', 'TEXT'], ['api_key_prefix', 'TEXT'], ['request_bytes', 'INTEGER'], ['response_bytes', 'INTEGER'],
  ] as const) {
    if (!existingRequestLogColumns.has(column)) db.exec(`ALTER TABLE api_request_logs ADD COLUMN ${column} ${definition}`);
  }
  const contactColumns = db.prepare('PRAGMA table_info(contacts)').all() as Array<{ name: string }>;
  const existingContactColumns = new Set(contactColumns.map(({ name }) => name));
  if (!existingContactColumns.has('consent_status')) db.exec("ALTER TABLE contacts ADD COLUMN consent_status TEXT NOT NULL DEFAULT 'unknown'");
  if (!existingContactColumns.has('consent_source')) db.exec('ALTER TABLE contacts ADD COLUMN consent_source TEXT');
  if (!existingContactColumns.has('consented_at')) db.exec('ALTER TABLE contacts ADD COLUMN consented_at TEXT');
  const automationEventColumns = db.prepare('PRAGMA table_info(automation_events)').all() as Array<{ name: string }>;
  if (!automationEventColumns.some(({ name }) => name === 'request_hash')) db.exec('ALTER TABLE automation_events ADD COLUMN request_hash TEXT');
  const emailEventColumns = db.prepare('PRAGMA table_info(email_events)').all() as Array<{ name: string }>;
  if (!emailEventColumns.some(({ name }) => name === 'target_url')) db.exec('ALTER TABLE email_events ADD COLUMN target_url TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS emails_scheduled_queue ON emails(status,scheduled_at,next_attempt_at)');
  db.exec('CREATE INDEX IF NOT EXISTS emails_broadcast_id ON emails(broadcast_id,created_at DESC)');
  const domainColumns = db.prepare('PRAGMA table_info(domains)').all() as Array<{ name: string }>;
  const existingDomainColumns = new Set(domainColumns.map(({ name }) => name));
  for (const [column, definition] of [['open_tracking', 'INTEGER NOT NULL DEFAULT 0'], ['click_tracking', 'INTEGER NOT NULL DEFAULT 0']] as const) {
    if (!existingDomainColumns.has(column)) db.exec(`ALTER TABLE domains ADD COLUMN ${column} ${definition}`);
  }
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

export async function consumeApiRequestLimit(_apiKeyId: string, perSecond = 10, nowMs = Date.now()) {
  const windowStarted = Math.floor(nowMs / API_RATE_LIMIT_WINDOW_MS);
  const result = await query<{ request_count: number }>(`INSERT INTO api_request_limits(workspace_id,window_started,request_count) VALUES(?,?,1)
    ON CONFLICT(workspace_id) DO UPDATE SET window_started=excluded.window_started,
    request_count=CASE WHEN api_request_limits.window_started=excluded.window_started THEN api_request_limits.request_count+1 ELSE 1 END
    RETURNING request_count`, ['default', windowStarted]);
  return apiRateLimitState(Number(result.rows[0]?.request_count ?? 0), perSecond, windowStarted * API_RATE_LIMIT_WINDOW_MS);
}

export function consumeLoginAttempt(sourceHash: string, perMinute = 10) {
  return consumeLimit(`INSERT INTO login_limits(source_hash,window_started,attempt_count) VALUES(?,?,1)
    ON CONFLICT(source_hash) DO UPDATE SET window_started=excluded.window_started,
    attempt_count=CASE WHEN login_limits.window_started=excluded.window_started THEN login_limits.attempt_count+1 ELSE 1 END
    RETURNING attempt_count`, sourceHash, perMinute);
}

export function consumeWebhookLimit(sourceHash: string, perMinute = 120) {
  return consumeLimit(`INSERT INTO webhook_limits(source_hash,window_started,request_count) VALUES(?,?,1)
    ON CONFLICT(source_hash) DO UPDATE SET window_started=excluded.window_started,
    request_count=CASE WHEN webhook_limits.window_started=excluded.window_started THEN webhook_limits.request_count+1 ELSE 1 END
    RETURNING request_count`, sourceHash, perMinute);
}
