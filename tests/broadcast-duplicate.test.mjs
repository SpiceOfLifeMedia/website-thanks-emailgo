import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { duplicateBroadcastName } from '../src/lib/broadcast-duplicate.ts';

test('broadcast copies use the 70-character suffix limit', () => {
  assert.equal(duplicateBroadcastName('A short campaign'), 'A short campaign (copy)');
  assert.equal(duplicateBroadcastName('A'.repeat(120)), `${'A'.repeat(63)} (copy)`);
  assert.equal(duplicateBroadcastName('A'.repeat(120)).length, 70);
});

test('any owned broadcast can be copied into a fresh draft', async (context) => {
  const originalDataDirectory = process.env.EMAILGO_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-broadcast-duplicate-'));
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
  const { duplicateBroadcast } = await import('../src/lib/broadcast-duplicate.ts');
  const now = new Date().toISOString();
  for (const [id, prefix] of [['key_1', 'eg_live_1'], ['key_2', 'eg_live_2']]) {
    await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', [id, id, prefix, 'test-hash', now]);
  }
  await database.execute(`INSERT INTO broadcasts(id,name,api_key_id,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id,status,scheduled_at,recipient_count,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'sent',?,?,?,?)`, [
    'broadcast_sent', 'A'.repeat(120), 'key_1', 'Team <hello@example.test>', 'A subject',
    'Plain copy', '<p>HTML copy</p>', '{"blocks":[]}', 'segment', 'segment_1', now, 14, now, now,
  ]);

  const duplicateId = await duplicateBroadcast('key_1', 'broadcast_sent');
  assert.ok(duplicateId);
  const duplicate = await database.queryOne('SELECT * FROM broadcasts WHERE id=?', [duplicateId]);
  assert.equal(duplicate?.name.length, 70);
  assert.equal(duplicate?.status, 'draft');
  assert.equal(duplicate?.scheduled_at, null);
  assert.equal(duplicate?.recipient_count, 0);
  assert.equal(duplicate?.folder_id, null);
  assert.equal(duplicate?.api_key_id, 'key_1');
  assert.equal(duplicate?.from_address, 'Team <hello@example.test>');
  assert.equal(duplicate?.subject, 'A subject');
  assert.equal(duplicate?.text_body, 'Plain copy');
  assert.equal(duplicate?.html_body, '<p>HTML copy</p>');
  assert.equal(duplicate?.editor_json, '{"blocks":[]}');
  assert.equal(duplicate?.audience_type, 'segment');
  assert.equal(duplicate?.audience_id, 'segment_1');
  assert.equal(await duplicateBroadcast('key_2', 'broadcast_sent'), null);
  assert.equal(await duplicateBroadcast('key_1', 'missing'), null);
});
