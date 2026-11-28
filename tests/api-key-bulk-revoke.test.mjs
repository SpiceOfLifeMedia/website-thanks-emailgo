import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const { resolve: resolveProjectImport } = await import('./tsconfig-paths-loader.mjs');
const headersMock = Buffer.from(`export async function cookies() { const values = globalThis.__sendThanksKeyBulkTestCookies ?? {}; return { get(name) { const value = values[name]; return typeof value === 'string' ? { value } : value; } }; }`).toString('base64');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: `data:text/javascript;base64,${headersMock}`, shortCircuit: true };
    if (specifier === 'next/server') return nextResolve(new URL('../node_modules/next/server.js', import.meta.url).href, context);
    return resolveProjectImport(specifier, context, nextResolve);
  },
});

test('dashboard bulk API key revocation requires trusted origin, admin session and typed confirmation', async (context) => {
  const savedEnvironment = {
    dataDirectory: process.env.EMAILGO_DATA_DIR,
    databaseUrl: process.env.DATABASE_URL,
    adminPassword: process.env.EMAILGO_ADMIN_PASSWORD,
    sessionSecret: process.env.EMAILGO_SESSION_SECRET,
  };
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-key-revoke-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  process.env.EMAILGO_ADMIN_PASSWORD = 'test-admin-password';
  process.env.EMAILGO_SESSION_SECRET = 'test-session-secret';
  delete process.env.DATABASE_URL;
  globalThis.__sendThanksKeyBulkTestCookies = {};

  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete globalThis.__sendThanksKeyBulkTestCookies;
    if (savedEnvironment.dataDirectory === undefined) delete process.env.EMAILGO_DATA_DIR;
    else process.env.EMAILGO_DATA_DIR = savedEnvironment.dataDirectory;
    if (savedEnvironment.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedEnvironment.databaseUrl;
    if (savedEnvironment.adminPassword === undefined) delete process.env.EMAILGO_ADMIN_PASSWORD;
    else process.env.EMAILGO_ADMIN_PASSWORD = savedEnvironment.adminPassword;
    if (savedEnvironment.sessionSecret === undefined) delete process.env.EMAILGO_SESSION_SECRET;
    else process.env.EMAILGO_SESSION_SECRET = savedEnvironment.sessionSecret;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const auth = await import('../src/lib/auth.ts');
  const database = await import('../src/lib/database.ts');
  const { DELETE } = await import('../src/app/api/keys/route.ts');
  const timestamp = new Date().toISOString();
  globalThis.__sendThanksKeyBulkTestCookies[auth.adminCookie] = auth.createAdminSession();
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['other', 'Other workspace', timestamp]);
  const keys = [
    ['key_aaaaaaaaaaaaaaaaaaaaaaaa', 'Selected key', 'hash_selected', 'default', null],
    ['key_bbbbbbbbbbbbbbbbbbbbbbbb', 'Keep key', 'hash_keep', 'default', null],
    ['key_cccccccccccccccccccccccc', 'Other workspace key', 'hash_other', 'other', null],
    ['key_dddddddddddddddddddddddd', 'Already revoked key', 'hash_revoked', 'default', timestamp],
  ];
  for (const [id, name, secretHash, workspaceId, revokedAt] of keys) {
    await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,permission,workspace_id,revoked_at) VALUES(?,?,?,?,?,?,?,?)', [id, name, `${id.slice(0, 12)}_`, secretHash, timestamp, 'full_access', workspaceId, revokedAt]);
  }
  const makeRequest = (body, origin = 'https://send-thanks.test') => new Request('https://send-thanks.test/api/keys', {
    method: 'DELETE',
    headers: { origin, host: 'send-thanks.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  globalThis.__sendThanksKeyBulkTestCookies = {};
  assert.equal((await DELETE(makeRequest({ ids: [keys[0][0]], confirmation: 'REVOKE API KEYS' }))).status, 401);
  globalThis.__sendThanksKeyBulkTestCookies[auth.adminCookie] = auth.createAdminSession();
  assert.equal((await DELETE(makeRequest({ ids: [keys[0][0]], confirmation: 'REVOKE API KEYS' }, 'https://attacker.test'))).status, 403);
  assert.equal((await DELETE(makeRequest({ ids: [keys[0][0]] }))).status, 400);
  assert.equal((await DELETE(makeRequest({ ids: ['key_aaaaaaaaaaaaaaaaaaaaaaaa OR 1=1'], confirmation: 'REVOKE API KEYS' }))).status, 400);
  assert.equal((await DELETE(makeRequest({ ids: Array.from({ length: 121 }, (_, index) => `key_${String(index).padStart(24, 'a')}`), confirmation: 'REVOKE API KEYS' }))).status, 400);
  assert.equal((await database.queryOne('SELECT revoked_at FROM api_keys WHERE id=?', [keys[0][0]]))?.revoked_at, null);

  const response = await DELETE(makeRequest({ ids: [keys[0][0], keys[0][0], keys[2][0]], confirmation: 'REVOKE API KEYS' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { object: 'list', revoked: 1, requested: 2 });
  assert.notEqual((await database.queryOne('SELECT revoked_at FROM api_keys WHERE id=?', [keys[0][0]]))?.revoked_at, null);
  assert.equal((await database.queryOne('SELECT revoked_at,secret_hash FROM api_keys WHERE id=?', [keys[1][0]]))?.revoked_at, null);
  assert.equal((await database.queryOne('SELECT revoked_at,secret_hash FROM api_keys WHERE id=?', [keys[2][0]]))?.revoked_at, null);
  assert.equal((await database.queryOne('SELECT secret_hash FROM api_keys WHERE id=?', [keys[0][0]]))?.secret_hash, 'hash_selected');
});
