import assert from 'node:assert/strict';
import { test } from 'node:test';
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
});
