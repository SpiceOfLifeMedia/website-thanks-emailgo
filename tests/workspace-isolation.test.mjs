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

test('SQLite backfills legacy keys, domains and contacts once and scopes unique values by workspace', async (context) => {
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
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
      properties_json TEXT NOT NULL, tags_json TEXT NOT NULL, unsubscribed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES('legacy_key','Legacy key','eg_live_legacy','legacy_hash','2026-01-01T00:00:00.000Z');
    INSERT INTO domains(id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking)
      VALUES('legacy_domain','old.example.test','verify=old','2026-01-01T00:00:00.000Z',NULL,1,0);
    INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at)
      VALUES('legacy_contact','shared@example.test','Legacy contact','{}','[]',NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  const database = await import('../src/lib/database.ts');
  const legacyKey = await database.queryOne('SELECT id,workspace_id FROM api_keys WHERE id=?', ['legacy_key']);
  const legacyDomain = await database.queryOne('SELECT id,domain,workspace_id,open_tracking,click_tracking FROM domains WHERE id=?', ['legacy_domain']);
  const legacyContact = await database.queryOne('SELECT id,email,workspace_id FROM contacts WHERE id=?', ['legacy_contact']);
  assert.equal(legacyKey?.id, 'legacy_key');
  assert.equal(legacyKey?.workspace_id, 'default');
  assert.equal(legacyDomain?.id, 'legacy_domain');
  assert.equal(legacyDomain?.domain, 'old.example.test');
  assert.equal(legacyDomain?.workspace_id, 'default');
  assert.equal(legacyDomain?.open_tracking, 1);
  assert.equal(legacyDomain?.click_tracking, 0);
  assert.equal(legacyContact?.id, 'legacy_contact');
  assert.equal(legacyContact?.email, 'shared@example.test');
  assert.equal(legacyContact?.workspace_id, 'default');

  await database.execute("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)", ['workspace_b', 'Workspace B', '2026-01-01T00:00:00.000Z']);
  await database.execute(`INSERT INTO domains(id,domain,verification_token,created_at,workspace_id)
    VALUES(?,?,?,?,?)`, ['workspace_b_domain', 'old.example.test', 'verify=b', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?,?,?,?)`, ['workspace_b_contact', 'shared@example.test', 'Workspace B contact', '{}', '[]', null, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'workspace_b']);

  const handle = globalThis.emailgoSqlite;
  handle.close();
  delete globalThis.emailgoSqlite;
  const workspaceCount = await database.queryOne('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM workspaces WHERE id=?', ['default']);
  const keyCount = await database.queryOne('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM api_keys WHERE id=? AND workspace_id=?', ['legacy_key', 'default']);
  const contactCounts = await database.query('SELECT workspace_id,CAST(COUNT(*) AS INTEGER) AS count FROM contacts WHERE lower(email)=lower(?) GROUP BY workspace_id ORDER BY workspace_id', ['shared@example.test']);
  assert.equal(workspaceCount?.count, 1);
  assert.equal(keyCount?.count, 1);
  assert.deepEqual(contactCounts.rows.map((row) => ({ ...row })), [
    { workspace_id: 'default', count: 1 },
    { workspace_id: 'workspace_b', count: 1 },
  ]);

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

test('API contact collection and item routes isolate two workspaces', async (context) => {
  setupTemporaryDatabase(context, 'send-thanks-workspace-contacts-');
  const database = await import('../src/lib/database.ts');
  const [contactCollection, contactItem, contactTopics, contactSegments, contactSegment, eventSend] = await Promise.all([
    import('../src/app/api/v1/contacts/route.ts'),
    import('../src/app/api/v1/contacts/[id]/route.ts'),
    import('../src/app/api/v1/contacts/[id]/topics/route.ts'),
    import('../src/app/api/v1/contacts/[id]/segments/route.ts'),
    import('../src/app/api/v1/contacts/[id]/segments/[segmentId]/route.ts'),
    import('../src/app/api/v1/events/send/route.ts'),
  ]);
  const timestamp = '2026-01-01T00:00:00.000Z';
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_a', 'Workspace A', timestamp]);
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_b', 'Workspace B', timestamp]);

  const secrets = {
    workspace_a: `eg_live_${Buffer.alloc(32, 3).toString('base64url')}`,
    workspace_b: `eg_live_${Buffer.alloc(32, 4).toString('base64url')}`,
  };
  for (const [id, workspaceId, secret] of [
    ['key_a', 'workspace_a', secrets.workspace_a],
    ['key_b', 'workspace_b', secrets.workspace_b],
  ]) {
    await database.execute(`INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,workspace_id) VALUES(?,?,?,?,?,?)`,
      [id, `Key ${workspaceId}`, secret.slice(0, 20), database.hashSecret(secret), timestamp, workspaceId]);
  }

  async function seedContact(id, email, workspaceId, createdAt) {
    await database.execute(`INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at,workspace_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [id, email, id, '{}', '[]', null, 'unknown', null, null, createdAt, createdAt, workspaceId]);
  }
  await seedContact('contact_a_older', 'shared@example.test', 'workspace_a', '2026-01-02T00:00:00.000Z');
  await seedContact('contact_a_newer', 'a-newer@example.test', 'workspace_a', '2026-01-03T00:00:00.000Z');
  await seedContact('contact_b', 'b-only@example.test', 'workspace_b', '2026-01-04T00:00:00.000Z');
  await database.execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at) VALUES(?,?,?,?,?)', ['shared_segment', 'Shared segment', '{"tags_all":["active"]}', timestamp, timestamp]);
  await database.execute('INSERT INTO topics(id,name,slug,description,created_at,updated_at) VALUES(?,?,?,?,?,?)', ['shared_topic', 'Shared topic', 'shared-topic', null, timestamp, timestamp]);

  async function request(handler, workspaceId, method = 'GET', path = 'http://send-thanks.test/api/v1/contacts', body, contextValue) {
    await database.execute('DELETE FROM api_request_limits');
    const request = new Request(path, {
      method,
      headers: {
        authorization: `Bearer ${secrets[workspaceId]}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return contextValue === undefined ? handler(request) : handler(request, contextValue);
  }
  const params = (id) => ({ params: Promise.resolve({ id }) });
  const contactSegmentParams = (id, segmentId) => ({ params: Promise.resolve({ id, segmentId }) });

  const firstPage = await request(contactCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts?limit=1');
  assert.equal(firstPage.status, 200);
  const firstPageBody = await firstPage.json();
  assert.deepEqual(firstPageBody.data.map(({ id }) => id), ['contact_a_newer']);
  assert.equal(firstPageBody.has_more, true);
  assert.equal(firstPageBody.next_after, 'contact_a_newer');

  const nextPage = await request(contactCollection.GET, 'workspace_a', 'GET', `http://send-thanks.test/api/v1/contacts?limit=1&after=${firstPageBody.next_after}`);
  assert.equal(nextPage.status, 200);
  const nextPageBody = await nextPage.json();
  assert.deepEqual(nextPageBody.data.map(({ id }) => id), ['contact_a_older']);
  assert.equal(nextPageBody.has_more, false);

  const foreignCursor = await request(contactCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts?limit=1&after=contact_b');
  assert.equal(foreignCursor.status, 400);

  const hiddenContact = await request(contactItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts/contact_b', undefined, params('contact_b'));
  assert.equal(hiddenContact.status, 404);
  const patchForeignContact = await request(contactItem.PATCH, 'workspace_a', 'PATCH', 'http://send-thanks.test/api/v1/contacts/contact_b', { name: 'Changed by workspace A' }, params('contact_b'));
  assert.equal(patchForeignContact.status, 404);
  const deleteForeignContact = await request(contactItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/contacts/contact_b', undefined, params('contact_b'));
  assert.equal(deleteForeignContact.status, 404);
  const foreignTopicRead = await request(contactTopics.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts/contact_b/topics', undefined, params('contact_b'));
  assert.equal(foreignTopicRead.status, 404);
  const foreignTopicWrite = await request(contactTopics.PUT, 'workspace_a', 'PUT', 'http://send-thanks.test/api/v1/contacts/contact_b/topics', { topic_ids: ['shared_topic'], consent_source: 'api request' }, params('contact_b'));
  assert.equal(foreignTopicWrite.status, 404);
  const foreignSegmentRead = await request(contactSegments.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts/contact_b/segments', undefined, params('contact_b'));
  assert.equal(foreignSegmentRead.status, 404);
  const foreignSegmentAdd = await request(contactSegment.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/contacts/contact_b/segments/shared_segment', undefined, contactSegmentParams('contact_b', 'shared_segment'));
  assert.equal(foreignSegmentAdd.status, 404);
  const foreignSegmentRemove = await request(contactSegment.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/contacts/contact_b/segments/shared_segment', undefined, contactSegmentParams('contact_b', 'shared_segment'));
  assert.equal(foreignSegmentRemove.status, 404);
  const foreignContactEvent = await request(eventSend.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/events/send', { event: 'account.updated', contact_id: 'contact_b' });
  assert.equal(foreignContactEvent.status, 404);

  const protectedContact = await database.queryOne('SELECT name,workspace_id FROM contacts WHERE id=?', ['contact_b']);
  assert.equal(protectedContact?.name, 'contact_b');
  assert.equal(protectedContact?.workspace_id, 'workspace_b');
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM contact_topics WHERE contact_id=?', ['contact_b']))?.count, 0);
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM segment_contacts WHERE contact_id=?', ['contact_b']))?.count, 0);
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM segment_contact_exclusions WHERE contact_id=?', ['contact_b']))?.count, 0);

  const createdByA = await request(contactCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/contacts', { email: 'created-a@example.test', name: 'Created A' });
  assert.equal(createdByA.status, 201);
  const createdA = await createdByA.json();
  const createdARow = await database.queryOne('SELECT email,workspace_id FROM contacts WHERE id=?', [createdA.id]);
  assert.equal(createdARow?.email, 'created-a@example.test');
  assert.equal(createdARow?.workspace_id, 'workspace_a');

  const sameNormalizedEmailInB = await request(contactCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/contacts', { email: 'SHARED@example.test', name: 'Shared in B' });
  assert.equal(sameNormalizedEmailInB.status, 201);
  const createdB = await sameNormalizedEmailInB.json();
  assert.equal(createdB.email, 'shared@example.test');
  const createdBRow = await database.queryOne('SELECT email,workspace_id FROM contacts WHERE id=?', [createdB.id]);
  assert.equal(createdBRow?.email, 'shared@example.test');
  assert.equal(createdBRow?.workspace_id, 'workspace_b');
});

test('CSV contact imports upsert only within the requested workspace', async (context) => {
  setupTemporaryDatabase(context, 'send-thanks-workspace-contact-import-');
  const database = await import('../src/lib/database.ts');
  const { importContactsCsv } = await import('../src/lib/contact-import.ts');
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_import', 'Import workspace', '2026-01-01T00:00:00.000Z']);

  const defaultImport = await importContactsCsv('email,name\nshared@example.test,Default contact\n', 'upsert', false);
  assert.equal(defaultImport.status, 200);
  const workspaceImport = await importContactsCsv('email,name\nshared@example.test,Workspace contact\n', 'upsert', false, undefined, 'workspace_import');
  assert.equal(workspaceImport.status, 200);
  const updateWorkspaceImport = await importContactsCsv('email,name\nshared@example.test,Updated workspace contact\n', 'upsert', false, undefined, 'workspace_import');
  assert.equal(updateWorkspaceImport.status, 200);

  const contacts = (await database.query('SELECT workspace_id,email,name FROM contacts ORDER BY workspace_id')).rows;
  assert.deepEqual(contacts.map((contact) => ({ ...contact })), [
    { workspace_id: 'default', email: 'shared@example.test', name: 'Default contact' },
    { workspace_id: 'workspace_import', email: 'shared@example.test', name: 'Updated workspace contact' },
  ]);
});
