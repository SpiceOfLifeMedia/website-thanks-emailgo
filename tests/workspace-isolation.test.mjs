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
    CREATE TABLE segments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE topics (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE, description TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE contact_topics (
      contact_id TEXT NOT NULL, topic_id TEXT NOT NULL, subscribed_at TEXT, unsubscribed_at TEXT,
      consent_source TEXT, consented_at TEXT, PRIMARY KEY(contact_id,topic_id),
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );
    CREATE TABLE contact_properties (
      property_key TEXT PRIMARY KEY, type TEXT NOT NULL, fallback_value_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE suppressions (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, normalized_email TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL DEFAULT 'manual', source_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE segment_contacts (
      segment_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(segment_id,contact_id),
      FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE,
      FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );
    INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES('legacy_key','Legacy key','eg_live_legacy','legacy_hash','2026-01-01T00:00:00.000Z');
    INSERT INTO domains(id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking)
      VALUES('legacy_domain','old.example.test','verify=old','2026-01-01T00:00:00.000Z',NULL,1,0);
    INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at)
      VALUES('legacy_contact','shared@example.test','Legacy contact','{}','[]',NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO segments(id,name,filters_json,created_at,updated_at)
      VALUES('legacy_segment','Legacy segment','{"tags_all":["legacy"]}','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO topics(id,name,slug,description,created_at,updated_at)
      VALUES('legacy_topic','Legacy topic','legacy-topic','Old topic','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO segment_contacts(segment_id,contact_id,created_at)
      VALUES('legacy_segment','legacy_contact','2026-01-01T00:00:00.000Z');
    INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,consent_source,consented_at)
      VALUES('legacy_contact','legacy_topic','2026-01-01T00:00:00.000Z','legacy import','2026-01-01T00:00:00.000Z');
    INSERT INTO contact_properties(property_key,type,fallback_value_json,created_at,updated_at)
      VALUES('legacy_profile','string','"legacy"','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO suppressions(id,email,normalized_email,origin,created_at)
      VALUES('legacy_suppression','blocked@example.test','blocked@example.test','manual','2026-01-01T00:00:00.000Z');
  `);
  legacy.close();

  const database = await import('../src/lib/database.ts');
  const legacyKey = await database.queryOne('SELECT id,workspace_id FROM api_keys WHERE id=?', ['legacy_key']);
  const legacyDomain = await database.queryOne('SELECT id,domain,workspace_id,open_tracking,click_tracking FROM domains WHERE id=?', ['legacy_domain']);
  const legacyContact = await database.queryOne('SELECT id,email,workspace_id FROM contacts WHERE id=?', ['legacy_contact']);
  const legacySegment = await database.queryOne('SELECT id,name,workspace_id FROM segments WHERE id=?', ['legacy_segment']);
  const legacySegmentMembership = await database.queryOne('SELECT segment_id,contact_id FROM segment_contacts WHERE segment_id=? AND contact_id=?', ['legacy_segment', 'legacy_contact']);
  const legacyTopic = await database.queryOne('SELECT id,name,slug,workspace_id,disabled_at FROM topics WHERE id=?', ['legacy_topic']);
  const legacyTopicMembership = await database.queryOne('SELECT contact_id,topic_id,consent_source FROM contact_topics WHERE contact_id=? AND topic_id=?', ['legacy_contact', 'legacy_topic']);
  const legacyProperty = await database.queryOne('SELECT property_key,type,fallback_value_json,workspace_id FROM contact_properties WHERE property_key=?', ['legacy_profile']);
  const legacySuppression = await database.queryOne('SELECT id,email,origin,workspace_id FROM suppressions WHERE id=?', ['legacy_suppression']);
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
  assert.equal(legacySegment?.id, 'legacy_segment');
  assert.equal(legacySegment?.name, 'Legacy segment');
  assert.equal(legacySegment?.workspace_id, 'default');
  assert.equal(legacySegmentMembership?.segment_id, 'legacy_segment');
  assert.equal(legacySegmentMembership?.contact_id, 'legacy_contact');
  assert.equal(legacyTopic?.id, 'legacy_topic');
  assert.equal(legacyTopic?.workspace_id, 'default');
  assert.equal(legacyTopic?.disabled_at, null);
  assert.equal(legacyTopicMembership?.contact_id, 'legacy_contact');
  assert.equal(legacyTopicMembership?.topic_id, 'legacy_topic');
  assert.equal(legacyTopicMembership?.consent_source, 'legacy import');
  assert.equal(legacyProperty?.property_key, 'legacy_profile');
  assert.equal(legacyProperty?.type, 'string');
  assert.equal(legacyProperty?.fallback_value_json, '"legacy"');
  assert.equal(legacyProperty?.workspace_id, 'default');
  assert.equal(legacySuppression?.id, 'legacy_suppression');
  assert.equal(legacySuppression?.email, 'blocked@example.test');
  assert.equal(legacySuppression?.origin, 'manual');
  assert.equal(legacySuppression?.workspace_id, 'default');

  await database.execute("INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)", ['workspace_b', 'Workspace B', '2026-01-01T00:00:00.000Z']);
  await database.execute(`INSERT INTO domains(id,domain,verification_token,created_at,workspace_id)
    VALUES(?,?,?,?,?)`, ['workspace_b_domain', 'old.example.test', 'verify=b', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?,?,?,?)`, ['workspace_b_contact', 'shared@example.test', 'Workspace B contact', '{}', '[]', null, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO segments(id,name,filters_json,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['workspace_b_segment', 'Legacy segment', '{"tags_all":["legacy"]}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO topics(id,name,slug,description,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?,?)`, ['workspace_b_topic', 'Legacy topic', 'legacy-topic', null, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO contact_properties(property_key,type,fallback_value_json,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['legacy_profile', 'number', '42', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'workspace_b']);
  await database.execute(`INSERT INTO suppressions(id,email,normalized_email,origin,created_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['workspace_b_suppression', 'blocked@example.test', 'blocked@example.test', 'manual', '2026-01-02T00:00:00.000Z', 'workspace_b']);

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
  await assert.rejects(database.execute(`INSERT INTO segments(id,name,filters_json,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['duplicate_default_segment', 'Legacy segment', '{"tags_all":["legacy"]}', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'default']));
  await assert.rejects(database.execute(`INSERT INTO topics(id,name,slug,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['duplicate_default_topic', 'Legacy topic', 'another-topic', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'default']));
  await assert.rejects(database.execute(`INSERT INTO contact_properties(property_key,type,created_at,updated_at,workspace_id)
    VALUES(?,?,?,?,?)`, ['legacy_profile', 'number', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'default']));
  await assert.rejects(database.execute(`INSERT INTO suppressions(id,email,normalized_email,origin,created_at,workspace_id)
    VALUES(?,?,?,?,?,?)`, ['duplicate_default_suppression', 'BLOCKED@example.test', 'blocked@example.test', 'manual', '2026-01-03T00:00:00.000Z', 'default']));
  assert.deepEqual(globalThis.emailgoSqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('API key and domain routes isolate two workspaces', async (context) => {
  setupTemporaryDatabase(context, 'send-thanks-workspace-api-');
  const database = await import('../src/lib/database.ts');
  const [domainCollection, domainItem, verifyDomain, inspectDns, keyCollection, keyItem, suppressionCollection, suppressionItem, suppressionLib] = await Promise.all([
    import('../src/app/api/v1/domains/route.ts'),
    import('../src/app/api/v1/domains/[id]/route.ts'),
    import('../src/app/api/v1/domains/[id]/verify/route.ts'),
    import('../src/app/api/v1/domains/[id]/dns/route.ts'),
    import('../src/app/api/v1/api-keys/route.ts'),
    import('../src/app/api/v1/api-keys/[id]/route.ts'),
    import('../src/app/api/v1/suppressions/route.ts'),
    import('../src/app/api/v1/suppressions/[suppression]/route.ts'),
    import('../src/lib/suppressions.ts'),
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
  const suppressionA = await request(suppressionCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/suppressions', { email: 'shared-block@example.test' });
  const suppressionB = await request(suppressionCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/suppressions', { email: 'shared-block@example.test' });
  assert.equal(suppressionA.status, 201);
  assert.equal(suppressionB.status, 201);
  const listA = await request(suppressionCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/suppressions');
  const listB = await request(suppressionCollection.GET, 'workspace_b', 'GET', 'http://send-thanks.test/api/v1/suppressions');
  const idA = (await suppressionA.json()).id;
  const idB = (await suppressionB.json()).id;
  assert.deepEqual((await listA.json()).data.map(({ id }) => id), [idA]);
  assert.deepEqual((await listB.json()).data.map(({ id }) => id), [idB]);
  const hiddenSuppression = await request(suppressionItem.GET, 'workspace_a', 'GET', `http://send-thanks.test/api/v1/suppressions/${idB}`, undefined, { params: Promise.resolve({ suppression: idB }) });
  assert.equal(hiddenSuppression.status, 404);
  assert.equal((await suppressionLib.findSuppressedAddresses(['shared-block@example.test'], 'workspace_a')).length, 1);
  assert.equal((await suppressionLib.findSuppressedAddresses(['shared-block@example.test'], 'workspace_b')).length, 1);
  const removeOnlyA = await request(suppressionItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/suppressions/shared-block@example.test', undefined, { params: Promise.resolve({ suppression: 'shared-block@example.test' }) });
  assert.equal(removeOnlyA.status, 200);
  assert.equal((await suppressionLib.findSuppressedAddresses(['shared-block@example.test'], 'workspace_a')).length, 0);
  assert.equal((await suppressionLib.findSuppressedAddresses(['shared-block@example.test'], 'workspace_b')).length, 1);
});

test('API contact collection and item routes isolate two workspaces', async (context) => {
  setupTemporaryDatabase(context, 'send-thanks-workspace-contacts-');
  const database = await import('../src/lib/database.ts');
  const [contactCollection, contactItem, contactTopics, contactSegments, contactSegment, eventSend, segmentCollection, segmentItem, segmentContacts, segmentMetrics, topicCollection, topicItem, preferencesRoute, broadcasts, contactImports, propertyCollection, propertyItem, suppressionLib] = await Promise.all([
    import('../src/app/api/v1/contacts/route.ts'),
    import('../src/app/api/v1/contacts/[id]/route.ts'),
    import('../src/app/api/v1/contacts/[id]/topics/route.ts'),
    import('../src/app/api/v1/contacts/[id]/segments/route.ts'),
    import('../src/app/api/v1/contacts/[id]/segments/[segmentId]/route.ts'),
    import('../src/app/api/v1/events/send/route.ts'),
    import('../src/app/api/v1/segments/route.ts'),
    import('../src/app/api/v1/segments/[id]/route.ts'),
    import('../src/app/api/v1/segments/[id]/contacts/route.ts'),
    import('../src/app/api/v1/segments/metrics/route.ts'),
    import('../src/app/api/v1/topics/route.ts'),
    import('../src/app/api/v1/topics/[id]/route.ts'),
    import('../src/app/api/preferences/[token]/route.ts'),
    import('../src/lib/broadcasts.ts'),
    import('../src/app/api/v1/contacts/imports/route.ts'),
    import('../src/app/api/v1/contact-properties/route.ts'),
    import('../src/app/api/v1/contact-properties/[key]/route.ts'),
    import('../src/lib/suppressions.ts'),
  ]);
  const originalPreferencesSecret = process.env.EMAILGO_PREFERENCES_SECRET;
  process.env.EMAILGO_PREFERENCES_SECRET = 'workspace-preferences-secret-at-least-32-chars';
  context.after(() => {
    if (originalPreferencesSecret === undefined) delete process.env.EMAILGO_PREFERENCES_SECRET;
    else process.env.EMAILGO_PREFERENCES_SECRET = originalPreferencesSecret;
  });
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
  await seedContact('contact_b', 'shared@example.test', 'workspace_b', '2026-01-04T00:00:00.000Z');
  for (const [id, workspaceId] of [['shared_segment_a', 'workspace_a'], ['shared_segment_b', 'workspace_b']]) {
    await database.execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,?)', [id, 'Shared segment', '{"tags_all":["active"]}', timestamp, timestamp, workspaceId]);
  }
  await database.execute("UPDATE contacts SET tags_json='[\"active\"]' WHERE id IN (?,?)", ['contact_a_older', 'contact_b']);
  await database.execute("UPDATE contacts SET consent_status='opted_in',consent_source='API import',consented_at=? WHERE id IN (?,?)", [timestamp, 'contact_a_older', 'contact_b']);
  for (const [id, workspaceId] of [['domain_a', 'workspace_a'], ['domain_b', 'workspace_b']]) {
    await database.execute('INSERT INTO domains(id,domain,verification_token,created_at,verified_at,workspace_id) VALUES(?,?,?,?,?,?)', [id, 'shared.example.test', `verify=${id}`, timestamp, timestamp, workspaceId]);
  }
  for (const [id, workspaceId] of [['shared_topic_a', 'workspace_a'], ['shared_topic_b', 'workspace_b']]) {
    await database.execute('INSERT INTO topics(id,name,slug,description,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,?,?)', [id, 'Shared topic', 'shared-topic', null, timestamp, timestamp, workspaceId]);
  }
  await database.execute(`INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,consent_source,consented_at)
    VALUES(?,?,?,?,?)`, ['contact_a_older', 'shared_topic_a', timestamp, 'API import', timestamp]);
  await database.execute(`INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,consent_source,consented_at)
    VALUES(?,?,?,?,?)`, ['contact_b', 'shared_topic_b', timestamp, 'API import', timestamp]);

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
  const foreignTopicWrite = await request(contactTopics.PUT, 'workspace_a', 'PUT', 'http://send-thanks.test/api/v1/contacts/contact_b/topics', { topic_ids: ['shared_topic_a'], consent_source: 'api request' }, params('contact_b'));
  assert.equal(foreignTopicWrite.status, 404);
  const foreignSegmentRead = await request(contactSegments.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts/contact_b/segments', undefined, params('contact_b'));
  assert.equal(foreignSegmentRead.status, 404);
  const foreignSegmentAdd = await request(contactSegment.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/contacts/contact_b/segments/shared_segment_b', undefined, contactSegmentParams('contact_b', 'shared_segment_b'));
  assert.equal(foreignSegmentAdd.status, 404);
  const foreignSegmentRemove = await request(contactSegment.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/contacts/contact_b/segments/shared_segment_b', undefined, contactSegmentParams('contact_b', 'shared_segment_b'));
  assert.equal(foreignSegmentRemove.status, 404);
  const foreignContactEvent = await request(eventSend.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/events/send', { event: 'account.updated', contact_id: 'contact_b' });
  assert.equal(foreignContactEvent.status, 404);

  const protectedContact = await database.queryOne('SELECT name,workspace_id FROM contacts WHERE id=?', ['contact_b']);
  assert.equal(protectedContact?.name, 'contact_b');
  assert.equal(protectedContact?.workspace_id, 'workspace_b');
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM contact_topics WHERE contact_id=? AND topic_id=?', ['contact_b', 'shared_topic_b']))?.count, 1);
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM segment_contacts WHERE contact_id=?', ['contact_b']))?.count, 0);
  assert.equal((await database.queryOne('SELECT COUNT(*) AS count FROM segment_contact_exclusions WHERE contact_id=?', ['contact_b']))?.count, 0);

  const visibleTopicsA = await request(topicCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/topics');
  const visibleTopicsB = await request(topicCollection.GET, 'workspace_b', 'GET', 'http://send-thanks.test/api/v1/topics');
  assert.deepEqual((await visibleTopicsA.json()).data.map(({ id }) => id), ['shared_topic_a']);
  assert.deepEqual((await visibleTopicsB.json()).data.map(({ id }) => id), ['shared_topic_b']);
  const ownTopic = await request(topicItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/topics/shared_topic_a', undefined, params('shared_topic_a'));
  assert.equal(ownTopic.status, 200);
  assert.equal((await ownTopic.json()).subscribers_count, 1);
  const hiddenTopic = await request(topicItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/topics/shared_topic_b', undefined, params('shared_topic_b'));
  assert.equal(hiddenTopic.status, 404);
  const hiddenTopicUpdate = await request(topicItem.PATCH, 'workspace_a', 'PATCH', 'http://send-thanks.test/api/v1/topics/shared_topic_b', { name: 'Changed', slug: 'changed' }, params('shared_topic_b'));
  assert.equal(hiddenTopicUpdate.status, 404);
  const hiddenTopicArchive = await request(topicItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/topics/shared_topic_b', undefined, params('shared_topic_b'));
  assert.equal(hiddenTopicArchive.status, 404);
  const foreignTopicSubscription = await request(contactTopics.PUT, 'workspace_a', 'PUT', 'http://send-thanks.test/api/v1/contacts/contact_a_older/topics', { topic_ids: ['shared_topic_b'], consent_source: 'api request' }, params('contact_a_older'));
  assert.equal(foreignTopicSubscription.status, 404);
  const ownTopicPreferences = await request(contactTopics.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contacts/contact_a_older/topics', undefined, params('contact_a_older'));
  assert.deepEqual((await ownTopicPreferences.json()).data.map(({ id }) => id), ['shared_topic_a']);
  const preferenceTokenModule = await import('../src/lib/contact-preferences.ts');
  const preferenceToken = preferenceTokenModule.createContactPreferenceToken({ contactId: 'contact_a_older', email: 'shared@example.test' });
  const publicPreferences = await preferencesRoute.GET(new Request(`http://send-thanks.test/api/preferences/${preferenceToken}`), { params: Promise.resolve({ token: preferenceToken }) });
  assert.equal(publicPreferences.status, 200);
  assert.deepEqual((await publicPreferences.json()).topics.map(({ id }) => id), ['shared_topic_a']);
  const crossWorkspacePreferenceWrite = await preferencesRoute.POST(new Request(`http://send-thanks.test/api/preferences/${preferenceToken}`, {
    method: 'POST',
    headers: { origin: 'http://send-thanks.test', host: 'send-thanks.test', 'content-type': 'application/json' },
    body: JSON.stringify({ topic_ids: ['shared_topic_b'] }),
  }), { params: Promise.resolve({ token: preferenceToken }) });
  assert.equal(crossWorkspacePreferenceWrite.status, 404);
  const ownAudience = await broadcasts.eligibleBroadcastContacts({ apiKeyId: 'key_a', audienceType: 'topic', audienceId: 'shared_topic_a' });
  const otherAudience = await broadcasts.eligibleBroadcastContacts({ apiKeyId: 'key_b', audienceType: 'topic', audienceId: 'shared_topic_b' });
  assert.deepEqual(ownAudience.map(({ id }) => id), ['contact_a_older']);
  assert.deepEqual(otherAudience.map(({ id }) => id), ['contact_b']);
  const validTopicAudience = await broadcasts.validateBroadcastInput({ apiKeyId: 'key_a', audienceType: 'topic', audienceId: 'shared_topic_a', from: 'hello@shared.example.test' });
  assert.equal(validTopicAudience.key.workspace_id, 'workspace_a');
  const foreignTopicAudience = await broadcasts.validateBroadcastInput({ apiKeyId: 'key_a', audienceType: 'topic', audienceId: 'shared_topic_b', from: 'hello@shared.example.test' });
  assert.equal(foreignTopicAudience.status, 404);
  async function importWithTopic(topicId, email, property = undefined) {
    const form = new FormData();
    const propertyColumn = property ? `,${property.key}` : '';
    const propertyValue = property ? `,${property.value}` : '';
    form.set('file', new Blob([`email,consent_status,consent_source,consented_at${propertyColumn}\n${email},opted_in,signup form,${timestamp}${propertyValue}\n`], { type: 'text/csv' }), 'contacts.csv');
    form.set('column_map', JSON.stringify({ email: 'email', ...(property ? { properties: { [property.key]: { column: property.key, type: property.type } } } : {}) }));
    form.set('topics', JSON.stringify([{ id: topicId, subscription: 'opt_in' }]));
    return contactImports.POST(new Request('http://send-thanks.test/api/v1/contacts/imports', {
      method: 'POST',
      headers: { authorization: `Bearer ${secrets.workspace_a}` },
      body: form,
    }));
  }
  const foreignTopicImport = await importWithTopic('shared_topic_b', 'foreign-topic-import@example.test');
  assert.equal(foreignTopicImport.status, 404);
  const validTopicImport = await importWithTopic('shared_topic_a', 'topic-import@example.test', { key: 'loyalty_band', value: 'gold', type: 'string' });
  assert.equal(validTopicImport.status, 201);
  assert.equal((await database.queryOne(`SELECT c.workspace_id,ct.topic_id FROM contacts c JOIN contact_topics ct ON ct.contact_id=c.id WHERE c.email=?`, ['topic-import@example.test']))?.topic_id, 'shared_topic_a');
  assert.equal((await database.queryOne('SELECT workspace_id FROM contacts WHERE email=?', ['topic-import@example.test']))?.workspace_id, 'workspace_a');
  assert.equal((await database.queryOne('SELECT type,workspace_id FROM contact_properties WHERE property_key=? AND workspace_id=?', ['loyalty_band', 'workspace_a']))?.type, 'string');
  const propertyA = await request(propertyCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/contact-properties', { key: 'profile_level', type: 'string', fallback_value: 'Workspace A' });
  const propertyB = await request(propertyCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/contact-properties', { key: 'profile_level', type: 'number', fallback_value: 42 });
  assert.equal(propertyA.status, 201);
  assert.equal(propertyB.status, 201);
  assert.equal((await propertyA.json()).fallback_value, 'Workspace A');
  assert.equal((await propertyB.json()).fallback_value, 42);
  const importedPropertyB = await request(propertyCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/contact-properties', { key: 'loyalty_band', type: 'number', fallback_value: 5 });
  assert.equal(importedPropertyB.status, 201);
  const propertyListA = await request(propertyCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contact-properties');
  const propertyListB = await request(propertyCollection.GET, 'workspace_b', 'GET', 'http://send-thanks.test/api/v1/contact-properties');
  assert.deepEqual((await propertyListA.json()).data.map(({ key }) => key), ['loyalty_band', 'profile_level']);
  assert.deepEqual((await propertyListB.json()).data.map(({ key }) => key), ['loyalty_band', 'profile_level']);
  const ownProperty = await request(propertyItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/contact-properties/profile_level', undefined, { params: Promise.resolve({ key: 'profile_level' }) });
  assert.equal(ownProperty.status, 200);
  assert.equal((await ownProperty.json()).fallback_value, 'Workspace A');
  const updateOwnProperty = await request(propertyItem.PATCH, 'workspace_a', 'PATCH', 'http://send-thanks.test/api/v1/contact-properties/profile_level', { fallback_value: 'Changed A' }, { params: Promise.resolve({ key: 'profile_level' }) });
  assert.equal(updateOwnProperty.status, 200);
  const deleteOwnProperty = await request(propertyItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/contact-properties/profile_level', undefined, { params: Promise.resolve({ key: 'profile_level' }) });
  assert.equal(deleteOwnProperty.status, 200);
  const propertyBAfterAttempt = await database.queryOne('SELECT type,fallback_value_json FROM contact_properties WHERE property_key=? AND workspace_id=?', ['profile_level', 'workspace_b']);
  assert.equal(propertyBAfterAttempt?.type, 'number');
  assert.equal(propertyBAfterAttempt?.fallback_value_json, '42');
  assert.equal((await database.queryOne('SELECT type,workspace_id FROM contact_properties WHERE property_key=? AND workspace_id=?', ['loyalty_band', 'workspace_b']))?.type, 'number');
  await suppressionLib.addSuppression('shared@example.test', 'manual', null, 'workspace_a');
  const afterWorkspaceASuppression = await broadcasts.eligibleBroadcastContacts({ apiKeyId: 'key_a', audienceType: 'topic', audienceId: 'shared_topic_a' });
  const unaffectedWorkspaceB = await broadcasts.eligibleBroadcastContacts({ apiKeyId: 'key_b', audienceType: 'topic', audienceId: 'shared_topic_b' });
  const importedTopicContact = await database.queryOne('SELECT id FROM contacts WHERE email=? AND workspace_id=?', ['topic-import@example.test', 'workspace_a']);
  assert.deepEqual(afterWorkspaceASuppression.map(({ id }) => id), [importedTopicContact?.id]);
  assert.deepEqual(unaffectedWorkspaceB.map(({ id }) => id), ['contact_b']);
  const sameNameTopicA = await request(topicCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/topics', { name: 'Separate topic', slug: 'separate-topic' });
  const sameNameTopicB = await request(topicCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/topics', { name: 'Separate topic', slug: 'separate-topic' });
  assert.equal(sameNameTopicA.status, 201);
  assert.equal(sameNameTopicB.status, 201);

  const visibleSegments = await request(segmentCollection.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments');
  assert.equal(visibleSegments.status, 200);
  assert.deepEqual((await visibleSegments.json()).data.map(({ id }) => id), ['shared_segment_a']);
  const ownSegment = await request(segmentItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/shared_segment_a', undefined, params('shared_segment_a'));
  assert.equal(ownSegment.status, 200);
  assert.equal((await ownSegment.json()).contacts_count, 1);
  const hiddenSegment = await request(segmentItem.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/shared_segment_b', undefined, params('shared_segment_b'));
  assert.equal(hiddenSegment.status, 404);
  const hiddenSegmentUpdate = await request(segmentItem.PATCH, 'workspace_a', 'PATCH', 'http://send-thanks.test/api/v1/segments/shared_segment_b', { name: 'Changed' }, params('shared_segment_b'));
  assert.equal(hiddenSegmentUpdate.status, 404);
  const hiddenSegmentDelete = await request(segmentItem.DELETE, 'workspace_a', 'DELETE', 'http://send-thanks.test/api/v1/segments/shared_segment_b', undefined, params('shared_segment_b'));
  assert.equal(hiddenSegmentDelete.status, 404);
  const hiddenSegmentContacts = await request(segmentContacts.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/shared_segment_b/contacts', undefined, params('shared_segment_b'));
  assert.equal(hiddenSegmentContacts.status, 404);
  const ownSegmentContacts = await request(segmentContacts.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/shared_segment_a/contacts', undefined, params('shared_segment_a'));
  assert.equal(ownSegmentContacts.status, 200);
  assert.deepEqual((await ownSegmentContacts.json()).data.map(({ id }) => id), ['contact_a_older']);
  const hiddenSegmentMetrics = await request(segmentMetrics.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/metrics?segment_id=shared_segment_b');
  assert.equal(hiddenSegmentMetrics.status, 404);
  const isolatedMetrics = await request(segmentMetrics.GET, 'workspace_a', 'GET', 'http://send-thanks.test/api/v1/segments/metrics');
  assert.equal((await isolatedMetrics.json()).totals.all_contacts, 3);
  const sameNameInA = await request(segmentCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/segments', { name: 'Separate name', filters: { tags_all: ['active'] } });
  const sameNameInB = await request(segmentCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/segments', { name: 'Separate name', filters: { tags_all: ['active'] } });
  assert.equal(sameNameInA.status, 201);
  assert.equal(sameNameInB.status, 201);
  const duplicateNameInA = await request(segmentCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/segments', { name: 'Shared segment', filters: { tags_all: ['active'] } });
  assert.equal(duplicateNameInA.status, 409);

  const createdByA = await request(contactCollection.POST, 'workspace_a', 'POST', 'http://send-thanks.test/api/v1/contacts', { email: 'created-a@example.test', name: 'Created A' });
  assert.equal(createdByA.status, 201);
  const createdA = await createdByA.json();
  const createdARow = await database.queryOne('SELECT email,workspace_id FROM contacts WHERE id=?', [createdA.id]);
  assert.equal(createdARow?.email, 'created-a@example.test');
  assert.equal(createdARow?.workspace_id, 'workspace_a');

  const sameNormalizedEmailInB = await request(contactCollection.POST, 'workspace_b', 'POST', 'http://send-thanks.test/api/v1/contacts', { email: 'CREATED-A@example.test', name: 'Shared in B' });
  assert.equal(sameNormalizedEmailInB.status, 201);
  const createdB = await sameNormalizedEmailInB.json();
  assert.equal(createdB.email, 'created-a@example.test');
  const createdBRow = await database.queryOne('SELECT email,workspace_id FROM contacts WHERE id=?', [createdB.id]);
  assert.equal(createdBRow?.email, 'created-a@example.test');
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
