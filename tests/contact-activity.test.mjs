import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { contactActivityQuery, decodeContactActivityCursor, encodeContactActivityCursor, safeContactActivityBounce, safeContactActivityDetail } from '../src/lib/contact-activity.ts';

function activityDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE contacts (id TEXT PRIMARY KEY,email TEXT,name TEXT,consent_status TEXT,consented_at TEXT,created_at TEXT,unsubscribed_at TEXT);
    CREATE TABLE emails (id TEXT PRIMARY KEY,to_json TEXT,cc_json TEXT,bcc_json TEXT,status TEXT,created_at TEXT,subject TEXT);
    CREATE TABLE email_events (id TEXT PRIMARY KEY,email_id TEXT,type TEXT,created_at TEXT);
    CREATE TABLE delivery_events (id TEXT PRIMARY KEY,recipient TEXT,event_type TEXT,created_at TEXT,detail TEXT,email_id TEXT);
    CREATE TABLE received_emails (id TEXT PRIMARY KEY,from_address TEXT,to_json TEXT,cc_json TEXT,bcc_json TEXT,subject TEXT,received_at TEXT);
  `);
  db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?)').run('ct_a', 'a@example.test', 'A', 'opted_in', '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-09T00:00:00.000Z');
  db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?,?,?)').run('ct_b', 'b@example.test', 'B', 'unknown', null, '2026-01-01T00:00:00.000Z', null);
  db.prepare('INSERT INTO emails VALUES(?,?,?,?,?,?,?)').run('em_group', JSON.stringify(['a@example.test', 'b@example.test']), null, null, 'sent', '2026-01-03T00:00:00.000Z', 'Group update');
  db.prepare('INSERT INTO emails VALUES(?,?,?,?,?,?,?)').run('em_single', JSON.stringify(['a@example.test']), null, null, 'sent', '2026-01-04T00:00:00.000Z', 'One to one');
  db.prepare('INSERT INTO emails VALUES(?,?,?,?,?,?,?)').run('em_other', JSON.stringify(['b@example.test']), null, null, 'sent', '2026-01-05T00:00:00.000Z', 'Other contact');
  db.prepare('INSERT INTO emails VALUES(?,?,?,?,?,?,?)').run('em_failed', JSON.stringify(['a@example.test']), null, null, 'failed', '2026-01-06T00:00:00.000Z', 'Not sent');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('email.sent:em_single', 'em_single', 'email.sent', '2026-01-04T00:05:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_group_open', 'em_group', 'email.opened', '2026-01-07T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_single_open', 'em_single', 'email.opened', '2026-01-08T00:00:00.000Z');
  db.prepare('INSERT INTO email_events VALUES(?,?,?,?)').run('evt_single_click', 'em_single', 'email.clicked', '2026-01-08T01:00:00.000Z');
  db.prepare('INSERT INTO delivery_events VALUES(?,?,?,?,?,?)').run('del_a', 'a@example.test', 'bounced', '2026-01-10T00:00:00.000Z', 'Permanent / MailboxFull', 'em_single');
  db.prepare('INSERT INTO delivery_events VALUES(?,?,?,?,?,?)').run('del_b', 'b@example.test', 'delivered', '2026-01-10T00:00:00.000Z', 'Delivered', 'em_group');
  db.prepare('INSERT INTO received_emails VALUES(?,?,?,?,?,?,?)').run('in_a', 'a@example.test', JSON.stringify(['team@example.test']), null, null, 'From contact', '2026-01-11T00:00:00.000Z');
  db.prepare('INSERT INTO received_emails VALUES(?,?,?,?,?,?,?)').run('in_not_a', 'elsewhere@example.test', JSON.stringify(['a@example.test']), null, null, 'Not from contact', '2026-01-12T00:00:00.000Z');
  return db;
}

test('contact activity is tied to the exact address and only shows attributable actions', () => {
  const db = activityDatabase();
  try {
    const statement = contactActivityQuery('ct_a', 'a@example.test', null, 100, false);
    const rows = db.prepare(statement.sql).all(...statement.params);
    const types = rows.map((row) => row.type);
    assert.deepEqual(types, [
      'email.received', 'delivery.bounced', 'contact.unsubscribed', 'email.clicked', 'email.opened',
      'email.sent', 'email.sent', 'contact.created',
    ]);
    assert.equal(rows.find((row) => row.type === 'email.sent')?.subject, 'One to one');
    assert.equal(rows.find((row) => row.type === 'delivery.bounced')?.detail, 'Permanent / MailboxFull');
    assert.equal(rows.filter((row) => row.type === 'email.sent').length, 2);
    assert.ok(!rows.some((row) => row.id.includes('evt_group_open')));
    assert.ok(!rows.some((row) => row.id.includes('del_b')));
    assert.ok(!rows.some((row) => row.id.includes('in_not_a')));
    assert.ok(!rows.some((row) => row.subject === 'Not sent'));
  } finally {
    db.close();
  }
});

test('contact activity cursor pages chronologically without repeating rows', () => {
  const db = activityDatabase();
  try {
    const firstQuery = contactActivityQuery('ct_a', 'a@example.test', null, 3, false);
    const first = db.prepare(firstQuery.sql).all(...firstQuery.params).slice(0, 3);
    const cursor = { created_at: first.at(-1).created_at, id: first.at(-1).id };
    const secondQuery = contactActivityQuery('ct_a', 'a@example.test', cursor, 3, false);
    const second = db.prepare(secondQuery.sql).all(...secondQuery.params).slice(0, 3);
    assert.equal(first.length, 3);
    assert.equal(second.length, 3);
    assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 6);
    assert.ok(first.at(-1).created_at >= second[0].created_at);
  } finally {
    db.close();
  }
});

test('activity cursors reject malformed data and query generation supports both databases', () => {
  const cursor = { created_at: '2026-01-01T00:00:00.000Z', id: 'email.sent:em_1' };
  assert.deepEqual(decodeContactActivityCursor(encodeContactActivityCursor(cursor)), cursor);
  assert.equal(decodeContactActivityCursor('bad!'), undefined);
  assert.equal(decodeContactActivityCursor(null), null);
  const postgres = contactActivityQuery('ct_1', 'a@example.test', cursor, 30, true);
  assert.match(postgres.sql, /jsonb_array_elements_text/);
  assert.match(postgres.sql, /jsonb_array_length/);
  assert.equal(postgres.params.length, 17);
  assert.equal(safeContactActivityDetail('delivery.bounced', 'Permanent / MailboxFull'), 'Mailbox is full');
  assert.equal(safeContactActivityDetail('delivery.bounced', 'Unknown / AccountSuppressionList'), null);
  assert.equal(safeContactActivityDetail('delivery.delayed', 'Transient / MailboxFull'), null);
  assert.deepEqual(safeContactActivityBounce('Transient / MailboxFull'), { bounceType: 'Temporary', bounceSubtype: 'Mailbox is full' });
  assert.deepEqual(safeContactActivityBounce('Undetermined / AccountSuppressionList'), { bounceType: 'Undetermined', bounceSubtype: null });
  assert.equal(safeContactActivityDetail('delivery.delayed', 'No retry detail'), 'Delivery will be tried again.');
});
