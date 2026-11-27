import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBroadcastMetadata } from '../src/lib/broadcast-metadata.ts';

test('broadcast metadata accepts a valid reply address and preview text', () => {
  assert.deepEqual(parseBroadcastMetadata('Team <reply@example.test>', 'A short inbox preview.'), {
    ok: true,
    value: { replyTo: 'Team <reply@example.test>', previewText: 'A short inbox preview.' },
  });
});

test('broadcast metadata normalizes omitted and empty values to null', () => {
  assert.deepEqual(parseBroadcastMetadata(undefined, '  '), { ok: true, value: { replyTo: null, previewText: null } });
  assert.deepEqual(parseBroadcastMetadata(' reply@example.test ', null), { ok: true, value: { replyTo: 'reply@example.test', previewText: null } });
});

test('broadcast metadata rejects malformed addresses, line breaks and oversized values', () => {
  assert.equal(parseBroadcastMetadata('bad-address', null).ok, false);
  assert.equal(parseBroadcastMetadata('reply@example.test\nBcc: other@example.test', null).ok, false);
  assert.equal(parseBroadcastMetadata(null, 'A'.repeat(501)).ok, false);
  assert.equal(parseBroadcastMetadata(null, 'first line\nsecond line').ok, false);
});
