import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExportPageQuery, exportFields, isExportResource, serializeCsvRow } from '../src/lib/csv-export.ts';

test('CSV export recognizes only the supported resource names', () => {
  assert.equal(isExportResource('emails'), true);
  assert.equal(isExportResource('received_emails'), true);
  assert.equal(isExportResource('secret_hash'), false);
  assert.equal(isExportResource(null), false);
});

test('email exports are scoped to the authenticated key and bind all filter values', () => {
  const result = buildExportPageQuery('emails', 'key-owned', { search: 'hello%', status: 'failed' }, { id: 'em_1', sortAt: '2026-11-27T12:00:00.000Z' }, 500);
  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.match(result.sql, /FROM emails WHERE api_key_id=\?/);
  assert.match(result.sql, /status=\?/);
  assert.match(result.sql, /created_at < \?/);
  assert.doesNotMatch(result.sql, /hello%|key-owned|failed|em_1/);
  assert.deepEqual(result.params, [
    'key-owned', '%hello%%', '%hello%%', '%hello%%', '%hello%%',
    'failed', '2026-11-27T12:00:00.000Z', '2026-11-27T12:00:00.000Z', 'em_1', 500,
  ]);
});

test('email exports omit content, and key exports omit secret material', () => {
  assert.equal(exportFields('emails').includes('html_body'), false);
  assert.equal(exportFields('emails').includes('text_body'), false);
  assert.equal(exportFields('api_keys').includes('secret_hash'), false);
  const keys = buildExportPageQuery('api_keys', 'key-owned', {}, null, 500);
  assert.equal('error' in keys, false);
  if (!('error' in keys)) assert.doesNotMatch(keys.sql, /secret_hash|api_key_id/);
});

test('log status filters accept error, success and bounded HTTP codes', () => {
  assert.equal('error' in buildExportPageQuery('logs', 'key', { status: 'errors' }, null, 500), false);
  assert.equal('error' in buildExportPageQuery('logs', 'key', { status: 'success' }, null, 500), false);
  assert.equal('error' in buildExportPageQuery('logs', 'key', { status: '600' }, null, 500), true);
  assert.equal('error' in buildExportPageQuery('contacts', 'key', { status: 'active' }, null, 500), true);
});

test('CSV serialization quotes cells and prevents spreadsheet formula execution', () => {
  assert.equal(serializeCsvRow(['=1+1', '-2', 'plain', 'comma,value', 'a"b', 'line\nbreak']), "'=1+1,'-2,plain,\"comma,value\",\"a\"\"b\",\"line\nbreak\"");
  assert.equal(serializeCsvRow(['\t=HYPERLINK("https://example.test")']), '"\'\t=HYPERLINK(""https://example.test"")"');
});
