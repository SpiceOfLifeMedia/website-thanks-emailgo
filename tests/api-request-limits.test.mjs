import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('API request limits are shared across keys and reset each second', async (context) => {
  const originalDataDirectory = process.env.EMAILGO_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-api-limit-'));
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
  const window = 1_700_000_000_000;
  let state;
  for (let index = 0; index < 5; index += 1) state = await database.consumeApiRequestLimit('default', 10, window + 250);
  for (let index = 0; index < 5; index += 1) state = await database.consumeApiRequestLimit('default', 10, window + 250);
  assert.deepEqual(state, { limit: 10, remaining: 0, resetAtMs: window + 1_000, allowed: true });

  state = await database.consumeApiRequestLimit('workspace_b', 10, window + 250);
  assert.deepEqual(state, { limit: 10, remaining: 9, resetAtMs: window + 1_000, allowed: true });
  state = await database.consumeApiRequestLimit('default', 10, window + 250);
  assert.deepEqual(state, { limit: 10, remaining: 0, resetAtMs: window + 1_000, allowed: false });
  state = await database.consumeApiRequestLimit('workspace_b', 10, window + 1_000);
  assert.deepEqual(state, { limit: 10, remaining: 9, resetAtMs: window + 2_000, allowed: true });

  const rows = await database.query('SELECT workspace_id,window_started,request_count FROM api_request_limits ORDER BY workspace_id');
  assert.deepEqual(rows.rows.map((row) => ({ ...row })), [
    { workspace_id: 'default', window_started: Math.floor((window + 250) / 1_000), request_count: 11 },
    { workspace_id: 'workspace_b', window_started: Math.floor((window + 1_000) / 1_000), request_count: 1 },
  ]);
});
