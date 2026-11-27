import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedMessageReferences, makeMessagePreview, normalizeFolder, parseMessageIds, replyReferences, replyRequestHash, safeLabels, searchClause } from '../src/lib/inbox-thread-utils.ts';

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
