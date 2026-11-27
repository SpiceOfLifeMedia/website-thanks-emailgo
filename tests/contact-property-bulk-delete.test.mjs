import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const { resolve: resolveProjectImport } = await import('./tsconfig-paths-loader.mjs');
const headersMock = Buffer.from(`export async function cookies() { const values = globalThis.__sendThanksPropertyTestCookies ?? {}; return { get(name) { const value = values[name]; return typeof value === 'string' ? { value } : value; } }; }`).toString('base64');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: `data:text/javascript;base64,${headersMock}`, shortCircuit: true };
    if (specifier === 'next/server') return nextResolve(new URL('../node_modules/next/server.js', import.meta.url).href, context);
    return resolveProjectImport(specifier, context, nextResolve);
  },
});

test('dashboard bulk property deletion requires trusted origin, admin session and typed confirmation', async (context) => {
  const savedEnvironment = {
    dataDirectory: process.env.EMAILGO_DATA_DIR,
    databaseUrl: process.env.DATABASE_URL,
    adminPassword: process.env.EMAILGO_ADMIN_PASSWORD,
    sessionSecret: process.env.EMAILGO_SESSION_SECRET,
  };
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-property-delete-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  process.env.EMAILGO_ADMIN_PASSWORD = 'test-admin-password';
  process.env.EMAILGO_SESSION_SECRET = 'test-session-secret';
  delete process.env.DATABASE_URL;
  globalThis.__sendThanksPropertyTestCookies = {};

  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete globalThis.__sendThanksPropertyTestCookies;
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
  const { DELETE } = await import('../src/app/api/contact-properties/route.ts');
  const timestamp = new Date().toISOString();
  globalThis.__sendThanksPropertyTestCookies[auth.adminCookie] = auth.createAdminSession();
  for (const [key, fallbackValue] of [['company', '"Acme"'], ['loyalty_points', '0']]) {
    await database.execute('INSERT INTO contact_properties(property_key,type,fallback_value_json,created_at,updated_at) VALUES(?,?,?,?,?)', [key, key === 'company' ? 'string' : 'number', fallbackValue, timestamp, timestamp]);
  }
  await database.execute('INSERT INTO contacts(id,email,name,properties_json,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', ['property_contact', 'property@example.test', 'Property contact', '{"company":"Acme","loyalty_points":42}', '[]', timestamp, timestamp]);

  const makeRequest = (body, origin = 'https://send-thanks.test') => new Request('https://send-thanks.test/api/contact-properties', {
    method: 'DELETE',
    headers: { origin, host: 'send-thanks.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  globalThis.__sendThanksPropertyTestCookies = {};
  assert.equal((await DELETE(makeRequest({ keys: ['company'], confirmation: 'DELETE DEFINITIONS' }))).status, 401);
  globalThis.__sendThanksPropertyTestCookies[auth.adminCookie] = auth.createAdminSession();
  assert.equal((await DELETE(makeRequest({ keys: ['company'], confirmation: 'DELETE DEFINITIONS' }, 'https://attacker.test'))).status, 403);
  assert.equal((await DELETE(makeRequest({ keys: ['company'] }))).status, 400);
  assert.equal((await DELETE(makeRequest({ keys: ['company OR 1=1'], confirmation: 'DELETE DEFINITIONS' }))).status, 400);
  assert.equal((await database.queryOne('SELECT property_key FROM contact_properties WHERE property_key=?', ['company']))?.property_key, 'company');

  const response = await DELETE(makeRequest({ keys: ['company', 'company'], confirmation: 'DELETE DEFINITIONS' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { object: 'list', deleted: 1, requested: 1 });
  assert.equal((await database.queryOne('SELECT property_key FROM contact_properties WHERE property_key=?', ['company']))?.property_key, undefined);
  assert.equal((await database.queryOne('SELECT property_key FROM contact_properties WHERE property_key=?', ['loyalty_points']))?.property_key, 'loyalty_points');
  assert.equal((await database.queryOne('SELECT properties_json FROM contacts WHERE id=?', ['property_contact']))?.properties_json, '{"company":"Acme","loyalty_points":42}');
});
