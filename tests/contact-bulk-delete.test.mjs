import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const { resolve: resolveProjectImport } = await import('./tsconfig-paths-loader.mjs');
const headersMock = Buffer.from(`export async function cookies() { const values = globalThis.__sendThanksContactTestCookies ?? {}; return { get(name) { const value = values[name]; return typeof value === 'string' ? { value } : value; } }; }`).toString('base64');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: `data:text/javascript;base64,${headersMock}`, shortCircuit: true };
    if (specifier === 'next/server') return nextResolve(new URL('../node_modules/next/server.js', import.meta.url).href, context);
    return resolveProjectImport(specifier, context, nextResolve);
  },
});

test('dashboard bulk contact deletion requires trusted origin, admin session and typed confirmation', async (context) => {
  const savedEnvironment = {
    dataDirectory: process.env.EMAILGO_DATA_DIR,
    databaseUrl: process.env.DATABASE_URL,
    adminPassword: process.env.EMAILGO_ADMIN_PASSWORD,
    sessionSecret: process.env.EMAILGO_SESSION_SECRET,
  };
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-contact-delete-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  process.env.EMAILGO_ADMIN_PASSWORD = 'test-admin-password';
  process.env.EMAILGO_SESSION_SECRET = 'test-session-secret';
  delete process.env.DATABASE_URL;
  globalThis.__sendThanksContactTestCookies = {};

  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete globalThis.__sendThanksContactTestCookies;
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
  const { DELETE } = await import('../src/app/api/contacts/route.ts');
  const timestamp = new Date().toISOString();
  globalThis.__sendThanksContactTestCookies[auth.adminCookie] = auth.createAdminSession();
  for (const [id, email] of [['selected_contact', 'selected@example.test'], ['keep_contact', 'keep@example.test']]) {
    await database.execute('INSERT INTO contacts(id,email,properties_json,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, email, '{}', '[]', timestamp, timestamp]);
  }
  await database.execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at) VALUES(?,?,?,?,?)', ['bulk_delete_segment', 'Bulk delete test', '{}', timestamp, timestamp]);
  await database.execute('INSERT INTO segment_contacts(segment_id,contact_id,created_at) VALUES(?,?,?)', ['bulk_delete_segment', 'selected_contact', timestamp]);

  const makeRequest = (body, origin = 'https://send-thanks.test') => new Request('https://send-thanks.test/api/contacts', {
    method: 'DELETE',
    headers: { origin, host: 'send-thanks.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  globalThis.__sendThanksContactTestCookies = {};
  assert.equal((await DELETE(makeRequest({ ids: ['selected_contact'], confirmation: 'DELETE CONTACTS' }))).status, 401);
  globalThis.__sendThanksContactTestCookies[auth.adminCookie] = auth.createAdminSession();
  assert.equal((await DELETE(makeRequest({ ids: ['selected_contact'], confirmation: 'DELETE CONTACTS' }, 'https://attacker.test'))).status, 403);
  assert.equal((await DELETE(makeRequest({ ids: ['selected_contact'] }))).status, 400);
  assert.equal((await DELETE(makeRequest({ ids: Array.from({ length: 121 }, (_, index) => `contact_${index}`), confirmation: 'DELETE CONTACTS' }))).status, 400);
  assert.equal((await database.queryOne('SELECT id FROM contacts WHERE id=?', ['selected_contact']))?.id, 'selected_contact');

  const response = await DELETE(makeRequest({ ids: ['selected_contact', 'selected_contact'], confirmation: 'DELETE CONTACTS' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { object: 'list', deleted: 1, requested: 1 });
  assert.equal((await database.queryOne('SELECT id FROM contacts WHERE id=?', ['selected_contact']))?.id, undefined);
  assert.equal((await database.queryOne('SELECT id FROM contacts WHERE id=?', ['keep_contact']))?.id, 'keep_contact');
  assert.equal((await database.queryOne('SELECT contact_id FROM segment_contacts WHERE contact_id=?', ['selected_contact']))?.contact_id, undefined);
});
