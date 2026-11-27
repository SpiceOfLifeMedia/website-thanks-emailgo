import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { parseSegmentFilters, segmentWhere } from '../src/lib/segments.ts';

const NOW = Date.parse('2026-02-01T00:00:00.000Z');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE contacts (id TEXT PRIMARY KEY,email TEXT NOT NULL,properties_json TEXT NOT NULL,tags_json TEXT NOT NULL,
      consent_status TEXT NOT NULL,unsubscribed_at TEXT,created_at TEXT NOT NULL,workspace_id TEXT NOT NULL DEFAULT 'default');
    CREATE TABLE api_keys (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);
    CREATE TABLE emails (id TEXT PRIMARY KEY,api_key_id TEXT,to_json TEXT,cc_json TEXT,bcc_json TEXT,status TEXT,created_at TEXT);
    CREATE TABLE email_events (id TEXT PRIMARY KEY,email_id TEXT,type TEXT,created_at TEXT);
    CREATE TABLE delivery_events (id TEXT PRIMARY KEY,email_id TEXT,recipient TEXT,event_type TEXT,created_at TEXT);
    CREATE TABLE segment_contacts (segment_id TEXT,contact_id TEXT,PRIMARY KEY(segment_id,contact_id));
    CREATE TABLE segment_contact_exclusions (segment_id TEXT,contact_id TEXT,PRIMARY KEY(segment_id,contact_id));
  `);
  db.prepare('INSERT INTO api_keys(id,workspace_id) VALUES(?,?)').run('key_default', 'default');
  db.prepare('INSERT INTO api_keys(id,workspace_id) VALUES(?,?)').run('key_other', 'workspace_other');
  const insertContact = db.prepare('INSERT INTO contacts(id,email,properties_json,tags_json,consent_status,unsubscribed_at,created_at) VALUES(?,?,?,?,?,?,?)');
  insertContact.run('ct_a', 'a@example.test', JSON.stringify({ plan: 'pro', spend: 125, empty: '' }), JSON.stringify(['customer', 'vip']), 'opted_in', null, '2026-01-01T00:00:00.000Z');
  insertContact.run('ct_b', 'b@example.test', JSON.stringify({ plan: 'basic', spend: 80 }), JSON.stringify(['customer']), 'opted_in', null, '2026-01-02T00:00:00.000Z');
  insertContact.run('ct_c', 'c@example.test', JSON.stringify({ plan: 'pro' }), '[]', 'unknown', null, '2026-01-03T00:00:00.000Z');
  insertContact.run('ct_d', 'd@example.test', JSON.stringify({ plan: 'pro', spend: 150 }), JSON.stringify(['vip']), 'opted_in', '2026-01-20T00:00:00.000Z', '2026-01-04T00:00:00.000Z');

  const insertEmail = db.prepare('INSERT INTO emails(id,api_key_id,to_json,cc_json,bcc_json,status,created_at) VALUES(?,?,?,?,?,?,?)');
  insertEmail.run('em_a', 'key_default', JSON.stringify(['a@example.test']), null, null, 'sent', '2026-01-20T00:00:00.000Z');
  insertEmail.run('em_group', 'key_default', JSON.stringify(['a@example.test', 'b@example.test']), null, null, 'sent', '2026-01-21T00:00:00.000Z');
  insertEmail.run('em_old', 'key_default', JSON.stringify(['c@example.test']), null, null, 'sent', '2025-11-01T00:00:00.000Z');
  insertEmail.run('em_b', 'key_default', JSON.stringify(['b@example.test']), null, null, 'sent', '2026-01-22T00:00:00.000Z');
  insertEmail.run('em_d', 'key_default', JSON.stringify(['d@example.test']), null, null, 'failed', '2026-01-22T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_sent_a', 'em_a', 'email.sent', '2026-01-20T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_open_a', 'em_a', 'email.opened', '2026-01-22T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_open_group', 'em_group', 'email.opened', '2026-01-23T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_open_old', 'em_old', 'email.opened', '2025-11-02T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_click_b', 'em_b', 'email.clicked', '2026-01-25T00:00:00.000Z');
  db.prepare('INSERT INTO delivery_events VALUES(?,?,?,?,?)').run('delivered_b', 'em_b', 'b@example.test', 'delivered', '2026-01-22T00:00:00.000Z');
  db.prepare('INSERT INTO delivery_events VALUES(?,?,?,?,?)').run('bounced_d', 'em_d', 'd@example.test', 'bounced', '2026-01-25T00:00:00.000Z');
  return db;
}

function matches(db, filters, segmentId, nowMs = NOW, workspaceId = 'default') {
  const { where, params } = segmentWhere(filters, segmentId, false, nowMs, workspaceId);
  return db.prepare(`SELECT c.email FROM contacts c WHERE ${where} ORDER BY c.email`).all(...params).map((row) => row.email);
}

test('segment filters retain legacy tag, consent and unsubscribe behavior', () => {
  const db = makeDb();
  try {
    assert.deepEqual(matches(db, { tags_all: ['customer'], consent_status: 'opted_in', unsubscribed: false }), ['a@example.test', 'b@example.test']);
    assert.deepEqual(matches(db, { tags_any: ['vip'] }), ['a@example.test', 'd@example.test']);
  } finally { db.close(); }
});

test('segment parser validates bounded property, activity, tag and consent conditions', () => {
  const valid = parseSegmentFilters({ groups: [{ match: 'all', rules: [
    { type: 'property', key: 'plan', value_type: 'string', operator: 'equals', value: 'pro' },
    { type: 'activity', event: 'email.opened', occurrence: 'occurred', within_days: 30 },
  ] }] });
  assert.equal(valid.ok, true);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'any', rules: [{ type: 'property', key: 'x); DROP TABLE contacts;--', value_type: 'string', operator: 'equals', value: 'y' }] }] }).ok, false);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.opened', occurrence: 'occurred', within_days: 3651 }] }] }).ok, false);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'contains', value: '10' }] }] }).ok, false);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'greater_than_or_equal', value: 10 }] }] }).ok, true);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'less_than_or_equal', value: 10 }] }] }).ok, true);
  assert.equal(parseSegmentFilters({ groups: [{ match: 'all', rules: [{ type: 'consent', operator: 'is', value: 'opted_out' }] }] }).ok, false);
  assert.equal(parseSegmentFilters({}).ok, false);
});

test('contact property rules support exact text, number comparisons and empty states', () => {
  const db = makeDb();
  try {
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'plan', value_type: 'string', operator: 'equals', value: 'pro' }] }] }), ['a@example.test', 'c@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'plan', value_type: 'string', operator: 'contains', value: 'ro' }] }] }), ['a@example.test', 'c@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'greater_than', value: 100 }] }] }), ['a@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'greater_than_or_equal', value: 125 }] }] }), ['a@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'less_than_or_equal', value: 80 }] }] }), ['b@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'spend', value_type: 'number', operator: 'is_set' }] }] }), ['a@example.test', 'b@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'plan', value_type: 'string', operator: 'is_empty' }] }] }), []);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'property', key: 'empty', value_type: 'string', operator: 'is_empty' }] }] }), ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test']);
  } finally { db.close(); }
});

test('condition groups combine rules with all or any semantics', () => {
  const db = makeDb();
  try {
    assert.deepEqual(matches(db, { groups: [{ match: 'any', rules: [
      { type: 'tag', operator: 'has', value: 'vip' },
      { type: 'property', key: 'plan', value_type: 'string', operator: 'equals', value: 'basic' },
    ] }] }), ['a@example.test', 'b@example.test', 'd@example.test']);
    assert.deepEqual(matches(db, { groups: [
      { match: 'any', rules: [{ type: 'tag', operator: 'has', value: 'customer' }, { type: 'tag', operator: 'has', value: 'vip' }] },
      { match: 'all', rules: [{ type: 'consent', operator: 'is', value: 'opted_in' }, { type: 'unsubscribed', value: false }] },
    ] }), ['a@example.test', 'b@example.test']);
    assert.deepEqual(matches(db, { groups_match: 'any', groups: [
      { match: 'all', rules: [{ type: 'tag', operator: 'has', value: 'vip' }] },
      { match: 'all', rules: [{ type: 'property', key: 'plan', value_type: 'string', operator: 'equals', value: 'basic' }] },
    ] }), ['a@example.test', 'b@example.test', 'd@example.test']);
  } finally { db.close(); }
});

test('email activity filters honor event types, recipient attribution and recent-day windows', () => {
  const db = makeDb();
  try {
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.opened', occurrence: 'occurred', within_days: 30 }] }] }), ['a@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.clicked', occurrence: 'occurred', within_days: 30 }] }] }), ['b@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.sent', occurrence: 'occurred', within_days: 30 }] }] }), ['a@example.test', 'b@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.delivered', occurrence: 'occurred', within_days: 30 }] }] }), ['b@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.bounced', occurrence: 'occurred', within_days: 30 }] }] }), ['d@example.test']);
    assert.deepEqual(matches(db, { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.opened', occurrence: 'not_occurred', within_days: 30 }] }] }), ['b@example.test', 'c@example.test', 'd@example.test']);
  } finally { db.close(); }
});

test('email activity conditions ignore messages owned by another workspace', () => {
  const db = makeDb();
  try {
    db.prepare('INSERT INTO contacts(id,email,properties_json,tags_json,consent_status,unsubscribed_at,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?)')
      .run('ct_other', 'other@example.test', '{}', '[]', 'unknown', null, '2026-01-01T00:00:00.000Z', 'workspace_other');
    db.prepare('INSERT INTO emails(id,api_key_id,to_json,status,created_at) VALUES(?,?,?,?,?)')
      .run('em_other', 'key_other', JSON.stringify(['other@example.test']), 'sent', '2026-01-20T00:00:00.000Z');
    db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_other_open', 'em_other', 'email.opened', '2026-01-22T00:00:00.000Z');
    const filters = { groups: [{ match: 'all', rules: [{ type: 'activity', event: 'email.opened', occurrence: 'occurred', within_days: 30 }] }] };
    assert.deepEqual(matches(db, filters, undefined, NOW, 'default'), ['a@example.test']);
    assert.deepEqual(matches(db, filters, undefined, NOW, 'workspace_other'), ['other@example.test']);
  } finally { db.close(); }
});

test('explicit membership is included and exclusions win over rules', () => {
  const db = makeDb();
  try {
    db.prepare('INSERT INTO segment_contacts VALUES(?,?)').run('seg_1', 'ct_c');
    db.prepare('INSERT INTO segment_contact_exclusions VALUES(?,?)').run('seg_1', 'ct_d');
    assert.deepEqual(matches(db, { tags_all: ['vip'] }, 'seg_1'), ['a@example.test', 'c@example.test']);
  } finally { db.close(); }
});

test('PostgreSQL predicates use JSONB and recipient-array expressions with bound values', () => {
  const result = segmentWhere({ groups: [{ match: 'all', rules: [
    { type: 'property', key: 'plan', value_type: 'string', operator: 'equals', value: 'pro' },
    { type: 'activity', event: 'email.opened', occurrence: 'occurred', within_days: 30 },
  ] }] }, undefined, true, NOW);
  assert.match(result.where, /jsonb_typeof\(c\.properties_json::jsonb -> \?\)/);
  assert.match(result.where, /jsonb_array_elements_text/);
  assert.match(result.where, /jsonb_array_length/);
  assert.equal(result.params.length, 7);
  assert.deepEqual(result.params.slice(0, 4), ['default', 'plan', 'plan', 'pro']);
  assert.deepEqual(result.params.slice(4), ['default', 'email.opened', '2026-01-02T00:00:00.000Z']);
});
