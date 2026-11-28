import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('reply drafts are durable per thread and require an owned thread', async (context) => {
  const originalDataDirectory = process.env.EMAILGO_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-inbox-drafts-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  delete process.env.DATABASE_URL;
  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    if (originalDataDirectory === undefined) delete process.env.EMAILGO_DATA_DIR;
    else process.env.EMAILGO_DATA_DIR = originalDataDirectory;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const database = await import('../src/lib/database.ts');
  const columns = await database.query('PRAGMA table_info(inbox_reply_drafts)');
  assert.deepEqual(columns.rows.map(({ name }) => name), ['thread_id', 'api_key_id', 'mode', 'from_address', 'to_text', 'cc_text', 'bcc_text', 'subject', 'text_body', 'updated_at']);

  const now = new Date().toISOString();
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', ['key_1', 'Test key', 'eg_live_test', 'hash', now]);
  await database.execute("INSERT INTO inbox_threads(id,api_key_id,subject,inbox_address,created_at,updated_at) VALUES(?,?,?,?,?,?)", ['thread_1', 'key_1', 'A subject', 'inbox@example.test', now, now]);
  await database.execute(`INSERT INTO inbox_reply_drafts(thread_id,api_key_id,mode,from_address,to_text,cc_text,bcc_text,subject,text_body,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, ['thread_1', 'key_1', 'reply_all', 'inbox@example.test', 'sender@example.test', 'team@example.test', '', 'Re: A subject', 'A saved thought', now]);
  await database.execute(`INSERT INTO inbox_reply_drafts(thread_id,api_key_id,mode,from_address,to_text,cc_text,bcc_text,subject,text_body,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET mode=excluded.mode,from_address=excluded.from_address,subject=excluded.subject,text_body=excluded.text_body,updated_at=excluded.updated_at`,
  ['thread_1', 'key_1', 'forward', 'inbox@example.test', '', '', '', 'Fwd: A subject', 'A newer note', now]);

  const saved = await database.queryOne('SELECT mode,from_address,subject,text_body FROM inbox_reply_drafts WHERE thread_id=?', ['thread_1']);
  assert.equal(saved.mode, 'forward');
  assert.equal(saved.from_address, 'inbox@example.test');
  assert.equal(saved.subject, 'Fwd: A subject');
  assert.equal(saved.text_body, 'A newer note');
  await assert.rejects(database.execute(`INSERT INTO inbox_reply_drafts(thread_id,api_key_id,updated_at) VALUES(?,?,?)`, ['missing_thread', 'key_1', now]));
});
