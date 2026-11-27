import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { boundedMessageReferences, composeRequestHash, composeSubject, extractMailboxAddress, makeMessagePreview, normalizeFolder, normalizeInboxRecipients, parseInboxRecipientText, parseMessageIds, replyAllRecipients, replyReferences, replyRequestHash, safeLabels, searchClause } from '../src/lib/inbox-thread-utils.ts';

test('parses bounded message IDs without turning header newlines into references', () => {
  assert.deepEqual(parseMessageIds('reply <one@example.test> <two@example.test>'), ['<one@example.test>', '<two@example.test>']);
  assert.deepEqual(parseMessageIds('one@example.test two@example.test'), ['<one@example.test>', '<two@example.test>']);
  assert.deepEqual(parseMessageIds('one@example.test\r\nBcc: someone@example.test'), []);
  assert.deepEqual(parseMessageIds('x'.repeat(5001)), []);
});

test('finds reply chain headers case-insensitively and removes duplicate IDs', () => {
  assert.deepEqual(replyReferences({
    'iN-rEpLy-To': '<newest@example.test>',
    References: '<root@example.test> <newest@example.test>',
  }), ['<newest@example.test>', '<root@example.test>']);
  assert.deepEqual(replyReferences(null), []);
});

test('bounds References without splitting a Message-ID token', () => {
  const oldId = `<${'a'.repeat(500)}@example.test>`;
  const newId = `<${'b'.repeat(500)}@example.test>`;
  assert.equal(boundedMessageReferences([oldId, newId]), newId);
  assert.equal(boundedMessageReferences([oldId], 200), '');
});

test('keeps the reply idempotency hash stable when a thread later changes', () => {
  const firstAttempt = replyRequestHash('rx_123', 'Thanks!');
  const retry = replyRequestHash('rx_123', 'Thanks!');
  assert.equal(firstAttempt, retry);
  assert.notEqual(firstAttempt, replyRequestHash('rx_123', 'Different reply'));
});

test('normalizes recipient arrays without accepting injected or malformed addresses', () => {
  assert.deepEqual(normalizeInboxRecipients(['First <first@example.test>', 'first@example.test', 'second@example.test']), ['first@example.test', 'second@example.test']);
  assert.equal(normalizeInboxRecipients(['first@example.test\r\nBcc: hidden@example.test']), null);
  assert.equal(normalizeInboxRecipients(Array.from({ length: 51 }, (_, index) => `user${index}@example.test`)), null);
  assert.deepEqual(parseInboxRecipientText('"Taylor, Lee" <taylor@example.test>, next@example.test'), ['taylor@example.test', 'next@example.test']);
  assert.equal(parseInboxRecipientText('not-an-address'), null);
  assert.equal(extractMailboxAddress('Team <team@example.test>'), 'team@example.test');
  assert.equal(extractMailboxAddress('team@example.test\nBcc: hidden@example.test'), null);
});

test('reply all preserves To and Cc, removes the inbox, and drops duplicates', () => {
  assert.deepEqual(replyAllRecipients({
    from: 'writer@example.test', replyTo: 'Reply desk <reply@example.test>',
    to: ['inbox@example.test', 'writer@example.test', 'teammate@example.test'],
    cc: ['teammate@example.test', 'observer@example.test'], inboxAddress: 'INBOX@example.test',
  }), { to: ['reply@example.test', 'writer@example.test', 'teammate@example.test'], cc: ['observer@example.test'] });
  assert.deepEqual(replyAllRecipients({ from: 'writer@example.test', to: ['inbox@example.test'], inboxAddress: 'inbox@example.test' }), {
    to: ['writer@example.test'], cc: [],
  });
});

test('composed subjects and idempotency include mode and recipients', () => {
  assert.equal(composeSubject('reply_all', 'Re: Topic'), 'Re: Topic');
  assert.equal(composeSubject('forward', 'Fwd: Topic'), 'Fwd: Topic');
  const first = composeRequestHash('rx_123', { mode: 'reply', from: 'inbox@example.test', to: ['a@example.test'], cc: [], bcc: [], subject: 'Re: Topic', text: 'Thanks' });
  assert.equal(first, composeRequestHash('rx_123', { mode: 'reply', from: 'inbox@example.test', to: ['a@example.test'], cc: [], bcc: [], subject: 'Re: Topic', text: 'Thanks' }));
  assert.notEqual(first, composeRequestHash('rx_123', { mode: 'reply_all', from: 'inbox@example.test', to: ['a@example.test'], cc: [], bcc: [], subject: 'Re: Topic', text: 'Thanks' }));
  assert.notEqual(first, composeRequestHash('rx_123', { mode: 'reply', from: 'other@example.test', to: ['a@example.test'], cc: [], bcc: [], subject: 'Re: Topic', text: 'Thanks' }));
});

test('accepts only known inbox folders', () => {
  assert.equal(normalizeFolder('inbox'), 'inbox');
  assert.equal(normalizeFolder('sent'), 'sent');
  assert.equal(normalizeFolder('../trash'), null);
});

test('converts HTML bodies to a short plain-text preview without scripts or markup', () => {
  assert.equal(makeMessagePreview(null, '<style>.x{}</style><p>Hello&nbsp;there &amp; welcome</p><script>leak()</script>'), 'Hello there & welcome');
  assert.equal(makeMessagePreview('  Plain\ntext  ', '<p>Ignored</p>'), 'Plain text');
  assert.equal(makeMessagePreview('x'.repeat(300), null).length, 240);
});

test('normalizes and validates thread labels', () => {
  assert.deepEqual(safeLabels(['  Billing  ', 'billing', 'Needs\tanswer']), ['Billing', 'Needs answer']);
  assert.equal(safeLabels(['']), null);
  assert.equal(safeLabels(['bad\nlabel']), null);
  assert.equal(safeLabels(Array.from({ length: 21 }, (_, index) => `Label ${index}`)), null);
});

test('escapes LIKE metacharacters in inbox search', () => {
  const clause = searchClause('A_100%');
  assert.match(clause.sql, /ESCAPE '!'/);
  assert.deepEqual(clause.params, ['%a!_100!%%', '%a!_100!%%', '%a!_100!%%', '%a!_100!%%']);
  assert.equal(clause.error, null);
});

test('parses quoted phrases and structured inbox filters', () => {
  const clause = searchClause('from:"Taylor Lee" to:inbox@example.test subject:"invoice 100%_!" after:2026-11-01 before:2026-12-01 is:unread');
  assert.equal(clause.error, null);
  assert.match(clause.sql, /ranked\.updated_at>=\?/);
  assert.match(clause.sql, /ranked\.updated_at<\?/);
  assert.match(clause.sql, /COALESCE\(threads\.is_read,0\)=0/);
  assert.deepEqual(clause.params, [
    '%taylor lee%', '%inbox@example.test%', '%invoice 100!%!_!!%',
    '2026-12-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z',
  ]);
});

test('returns a clear search error for unmatched quotes, empty filters, and invalid dates', () => {
  assert.equal(searchClause('""').error, 'Add a word or filter to search conversations.');
  assert.equal(searchClause('subject:"unfinished phrase').error, 'Add a closing quote to finish this search.');
  assert.equal(searchClause('from:').error, 'Add a value after from: to finish this search.');
  assert.equal(searchClause('after:2026-02-30').error, 'after: needs a valid date in YYYY-MM-DD format.');
  assert.equal(searchClause('is:important').error, 'Use is:read or is:unread to filter read state.');
});

test('searches unknown operators as text and supports read filters', () => {
  const unknown = searchClause('has:attachment');
  assert.equal(unknown.error, null);
  assert.deepEqual(unknown.params, ['%has:attachment%', '%has:attachment%', '%has:attachment%', '%has:attachment%']);
  assert.match(searchClause('is:read').sql, /COALESCE\(threads\.is_read,0\)=1/);
  assert.match(searchClause('IS:UNREAD').sql, /COALESCE\(threads\.is_read,0\)=0/);
  assert.equal(searchClause('is:read is:unread').error, 'Choose either is:read or is:unread for this search.');
});

test('uses the same structured search predicate for inbox results, counts, unread totals, and cursor pages', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE messages(thread_id TEXT, sender TEXT, recipients_json TEXT, subject TEXT, preview TEXT);
    CREATE TABLE inbox_threads(id TEXT PRIMARY KEY, is_read INTEGER);
    CREATE TABLE ranked(thread_id TEXT, updated_at TEXT, latest_rank INTEGER);
  `);
  const insertMessage = database.prepare('INSERT INTO messages VALUES(?,?,?,?,?)');
  const insertThread = database.prepare('INSERT INTO inbox_threads VALUES(?,?)');
  const insertRanked = database.prepare('INSERT INTO ranked VALUES(?,?,1)');
  const fixtures = [
    { id: 'thread_a', date: '2026-11-20T10:00:00.000Z', read: 0, sender: 'Alice <alice@example.test>', subject: 'Invoice 41', preview: 'Please review it' },
    { id: 'thread_b', date: '2026-11-19T10:00:00.000Z', read: 1, sender: 'Bob <bob@example.test>', subject: 'Invoice question', preview: 'A reply is here' },
    { id: 'thread_c', date: '2026-10-01T10:00:00.000Z', read: 0, sender: 'Casey <casey@example.test>', subject: 'Project update', preview: 'No match' },
  ];
  for (const row of fixtures) {
    insertThread.run(row.id, row.read);
    insertRanked.run(row.id, row.date);
    insertMessage.run(row.id, row.sender, '["inbox@example.test"]', row.subject, row.preview);
  }

  const clause = searchClause('invoice after:2026-11-01 before:2026-11-22');
  const joins = 'FROM ranked LEFT JOIN inbox_threads threads ON threads.id=ranked.thread_id';
  const where = `ranked.latest_rank=1 AND ${clause.sql}`;
  const parameters = clause.params;
  const listed = database.prepare(`SELECT ranked.thread_id,ranked.updated_at ${joins} WHERE ${where} ORDER BY ranked.updated_at DESC,ranked.thread_id DESC`).all(...parameters);
  const total = database.prepare(`SELECT COUNT(*) AS count ${joins} WHERE ${where}`).get(...parameters).count;
  const unread = database.prepare(`SELECT COUNT(*) AS count ${joins} WHERE ${where} AND COALESCE(threads.is_read,0)=0`).get(...parameters).count;
  const firstPage = database.prepare(`SELECT ranked.thread_id,ranked.updated_at ${joins} WHERE ${where} ORDER BY ranked.updated_at DESC,ranked.thread_id DESC LIMIT 1`).all(...parameters);
  const cursor = firstPage[0];
  const nextPage = database.prepare(`SELECT ranked.thread_id,ranked.updated_at ${joins} WHERE ${where} AND (ranked.updated_at<? OR (ranked.updated_at=? AND ranked.thread_id<?)) ORDER BY ranked.updated_at DESC,ranked.thread_id DESC LIMIT 1`).all(
    ...parameters, cursor.updated_at, cursor.updated_at, cursor.thread_id,
  );

  assert.deepEqual(listed.map((row) => row.thread_id), ['thread_a', 'thread_b']);
  assert.equal(total, 2);
  assert.equal(unread, 1);
  assert.equal(firstPage[0].thread_id, 'thread_a');
  assert.equal(nextPage[0].thread_id, 'thread_b');
  database.close();
});
