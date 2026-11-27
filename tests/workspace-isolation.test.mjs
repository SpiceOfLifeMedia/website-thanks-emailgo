import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const { resolve: resolveProjectImport } = await import('./tsconfig-paths-loader.mjs');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return nextResolve(new URL('../node_modules/next/headers.js', import.meta.url).href, context);
    if (specifier === 'next/server') return nextResolve(new URL('../node_modules/next/server.js', import.meta.url).href, context);
    return resolveProjectImport(specifier, context, nextResolve);
  },
});

function setupTemporaryDatabase(context, prefix) {
  const originalDataDirectory = process.env.EMAILGO_DATA_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dataDirectory = mkdtempSync(join(tmpdir(), prefix));
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
  return dataDirectory;
}

test('SQLite backfills legacy keys and domains once and replaces global domain uniqueness', async (context) => {
  const dataDirectory = setupTemporaryDatabase(context, 'send-thanks-workspace-migration-');
  const databaseFile = join(dataDirectory, 'emailgo.sqlite');
  const legacy = new DatabaseSync(databaseFile);
  legacy.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE,
      secret_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT,
      permission TEXT NOT NULL DEFAULT 'full_access', domain_id TEXT, revoked_at TEXT
    );
    CREATE TABLE domains (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL UNIQUE, verification_token TEXT NOT NULL,
      created_at TEXT NOT NULL, verified_at TEXT,
      open_tracking INTEGER NOT NULL DEFAULT 0, click_tracking INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES('legacy_key','Legacy key','eg_live_legacy','legacy_hash','2026-01-01T00:00:00.000Z');
    INSERT INTO domains(id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking)
      VALUES('legacy_domain','old.example.test','verify=old','2026-01-01T00:00:00.000Z',NULL,1,0);
  `);
  legacy.close();

  const database = await import('../src/lib/database.ts');
  const legacyKey = await database.queryOne('SELECT id,workspace_id FROM api_keys WHERE id=?', ['legacy_key']);
  const legacyDomain = await database.queryOne('SELECT id,domain,workspace_id,open_tracking,click_tracking FROM domains WHERE id=?', ['legacy_domain']);
  assert.equal(legacyKey?.id, 'legacy_key');
  assert.equal(legacyKey?.workspace_id, 'default');
  assert.equal(legacyDomain?.id, 'legacy_domain');
  assert.equal(legacyDomain?.domain, 'old.example.test');
  assert.equal(legacyDomain?.workspace_id, 'default');
  assert.equal(legacyDomain?.open_tracking, 1);
  assert.equal(legacyDomain?.click_tracking, 0);

  await database.execute("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)", ['workspace_b', 'Workspace B', '2026-01-01T00:00:00.000Z']);
  await database.execute(`INSERT INTO domains(id,domain,verification_token,created_at,workspace_id)
    VALUES(?,?,?,?,?)`, ['workspace_b_domain', 'old.example.test', 'verify=b', '2026-01-02T00:00:00.000Z', 'workspace_b']);

  const handle = globalThis.emailgoSqlite;
  handle.close();
  delete globalThis.emailgoSqlite;
  const workspaceCount = await database.queryOne('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM workspaces WHERE id=?', ['default']);
  const keyCount = await database.queryOne('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM api_keys WHERE id=? AND workspace_id=?', ['legacy_key', 'default']);
  assert.equal(workspaceCount?.count, 1);
  assert.equal(keyCount?.count, 1);

  await assert.rejects(database.execute(`INSERT INTO domains(id,domain,verification_token,created_at,workspace_id)
    VALUES(?,?,?,?,?)`, ['duplicate_default_domain', 'old.example.test', 'verify=dup', '2026-01-03T00:00:00.000Z', 'default']));
});

test('API key and domain routes isolate two workspaces', async (context) => {
  setupTemporaryDatabase(context, 'send-thanks-workspace-api-');
  const database = await import('../src/lib/database.ts');
  const [domainCollection, domainItem, verifyDomain, inspectDns, keyCollection, keyItem] = await Promise.all([
    import('../src/app/api/v1/domains/route.ts'),
    import('../src/app/api/v1/domains/[id]/route.ts'),
    import('../src/app/api/v1/domains/[id]/verify/route.ts'),
    import('../src/app/api/v1/domains/[id]/dns/route.ts'),
    import('../src/app/api/v1/api-keys/route.ts'),
    import('../src/app/api/v1/api-keys/[id]/route.ts'),
  ]);
  const timestamp = '2026-01-01T00:00:00.000Z';
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_a', 'Workspace A', timestamp]);
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_b', 'Workspace B', timestamp]);

  const secrets = {
    key_a: `eg_live_${Buffer.alloc(32, 1).toString('base64url')}`,
    key_b: `eg_live_${Buffer.alloc(32, 2).toString('base64url')}`,
  };
  await database.execute(`INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,workspace_id) VALUES(?,?,?,?,?,?)`,
    ['key_a', 'Key A', secrets.key_a.slice(0, 20), database.hashSecret(secrets.key_a), timestamp, 'workspace_a']);
  await database.execute(`INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,workspace_id) VALUES(?,?,?,?,?,?)`,
    ['key_b', 'Key B', secrets.key_b.slice(0, 20), database.hashSecret(secrets.key_b), timestamp, 'workspace_b']);
  for (const [id, workspaceId] of [['domain_a', 'workspace_a'], ['domain_b', 'workspace_b']]) {
    await database.execute(`INSERT INTO domains(id,domain,verification_token,created_at,verified_at,workspace_id)
      VALUES(?,?,?,?,?,?)`, [id, 'shared.example.test', `verify=${id}`, timestamp, timestamp, workspaceId]);
  }

  async function request(handler, workspace, method = 'GET', path = 'http://send-thanks.test/api/v1/domains', body, contextValue) {
    await database.execute('DELETE FROM api_request_limits');
    const request = new Request(path, {
      method,
      headers: {
        authorization: `Bearer ${secrets[workspace === 'workspace_a' ? 'key_a' : 'key_b']}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return handler(request, contextValue);
  }
  const params = (id) => ({ params: Promise.resolve({ id }) });

  for (const [workspace, ownDomainId, otherDomainId, ownKeyId, otherKeyId] of [
    ['workspace_a', 'domain_a', 'domain_b', 'key_a', 'key_b'],
    ['workspace_b', 'domain_b', 'domain_a', 'key_b', 'key_a'],
  ]) {
    const domains = await request(domainCollection.GET, workspace);
    assert.equal(domains.status, 200);
    assert.deepEqual((await domains.json()).data.map(({ id }) => id), [ownDomainId]);
    const rateLimit = await database.queryOne('SELECT workspace_id FROM api_request_limits');
    assert.equal(rateLimit?.workspace_id, workspace);

    const keys = await request(keyCollection.GET, workspace, 'GET', 'http://send-thanks.test/api/v1/api-keys');
    assert.equal(keys.status, 200);
    assert.deepEqual((await keys.json()).data.map(({ id }) => id), [ownKeyId]);

    const ownDomain = await request(domainItem.GET, workspace, 'GET', `http://send-thanks.test/api/v1/domains/${ownDomainId}`, undefined, params(ownDomainId));
    assert.equal(ownDomain.status, 200);
    const hiddenDomain = await request(domainItem.GET, workspace, 'GET', `http://send-thanks.test/api/v1/domains/${otherDomainId}`, undefined, params(otherDomainId));
    assert.equal(hiddenDomain.status, 404);

    const hiddenKey = await request(keyItem.GET, workspace, 'GET', `http://send-thanks.test/api/v1/api-keys/${otherKeyId}`, undefined, params(otherKeyId));
    assert.equal(hiddenKey.status, 404);
    const renameOtherKey = await request(keyItem.PATCH, workspace, 'PATCH', `http://send-thanks.test/api/v1/api-keys/${otherKeyId}`, { name: 'Changed by another workspace' }, params(otherKeyId));
    assert.equal(renameOtherKey.status, 404);
    const revokeOtherKey = await request(keyItem.DELETE, workspace, 'DELETE', `http://send-thanks.test/api/v1/api-keys/${otherKeyId}`, undefined, params(otherKeyId));
    assert.equal(revokeOtherKey.status, 404);
  }

  const hiddenDomainUpdate = await request(domainItem.PATCH, 'workspace_a', 'PATCH', 'http://send-thanks.test/api/v1/domains/domain_b', { open_tracking: true }, params('domain_b'));
  assert.equal(hiddenDomainUpdate.status, 404);
  const hiddenDomainDelete = await request(domainItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/domains/domain_b', undefined, params('domain_b'));
  assert.equal(hiddenDomainDelete.status, 404);
  const hiddenDomainVerify = await request(verifyDomain.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/domains/domain_b/verify', undefined, params('domain_b'));
  assert.equal(hiddenDomainVerify.status, 404);
  const hiddenDomainDns = await request(inspectDns.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/domains/domain_b/dns', undefined, params('domain_b'));
  assert.equal(hiddenDomainDns.status, 404);

  const newDomainA = await request(domainCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/domains', { domain: 'new-a.example.test' });
  assert.equal(newDomainA.status, 201);
  const newDomainRow = await database.queryOne('SELECT workspace_id FROM domains WHERE domain=?', ['new-a.example.test']);
  assert.equal(newDomainRow?.workspace_id, 'workspace_a');

  const crossWorkspaceDomainKey = await request(keyCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/api-keys', {
    name: 'Invalid cross-workspace domain key', permission: 'sending_access', domain_id: 'domain_b',
  });
  assert.equal(crossWorkspaceDomainKey.status, 400);

  const keyA = await database.queryOne('SELECT name,revoked_at FROM api_keys WHERE id=?', ['key_a']);
  const domainB = await database.queryOne('SELECT open_tracking,workspace_id FROM domains WHERE id=?', ['domain_b']);
  assert.equal(keyA?.name, 'Key A');
  assert.equal(keyA?.revoked_at, null);
  assert.equal(domainB?.open_tracking, 0);
  assert.equal(domainB?.workspace_id, 'workspace_b');
});
