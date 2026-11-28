import test from 'node:test';
import assert from 'node:assert/strict';
import { SendThanks } from '../packages/send-thanks-sdk/index.mjs';

test('SDK creates a share link with the requested expiration', async () => {
  const calls = [];
  const client = new SendThanks('st_live_example', {
    baseUrl: 'https://mail.example.test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ object: 'email', id: 'em_123', url: 'https://mail.example.test/share/shr_live_example', share_id: 'share_123', expires_at: '2026-11-27T12:00:00.000Z' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await client.emails.share('em/123', { expiresIn: '2 hours' });
  assert.equal(result.error, null);
  assert.equal(calls[0].url, 'https://mail.example.test/api/v1/emails/em%2F123/share');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { expires_in: '2 hours' });
});

test('SDK revokes a share link by its share ID', async () => {
  const calls = [];
  const client = new SendThanks('st_live_example', {
    baseUrl: 'https://mail.example.test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await client.emails.revokeShare('em 123', 'share/456');
  assert.equal(result.error, null);
  assert.equal(calls[0].url, 'https://mail.example.test/api/v1/emails/em%20123/share/share%2F456');
  assert.equal(calls[0].init.method, 'DELETE');
});

test('SDK retries a failed automation run with explicit duplicate-send confirmation', async () => {
  const calls = [];
  const client = new SendThanks('st_live_example', {
    baseUrl: 'https://mail.example.test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ object: 'automation_run', id: 'run_123', status: 'running', attempt: 2 }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const result = await client.automations.retryRun('auto/123', 'run 456', { confirm_send_retry: true });
  assert.equal(result.error, null);
  assert.equal(calls[0].url, 'https://mail.example.test/api/v1/automations/auto%2F123/runs/run%20456/retry');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { confirm_send_retry: true });
});

test('SDK downloads a filtered CSV export as text', async () => {
  const calls = [];
  const client = new SendThanks('st_live_example', {
    baseUrl: 'https://mail.example.test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('id,email\r\nct_1,sam@example.test\r\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    },
  });
  const result = await client.exports.csv({ resource: 'contacts', search: 'sam@example.test' });
  assert.equal(result.error, null);
  assert.equal(result.data, 'id,email\r\nct_1,sam@example.test\r\n');
  assert.equal(calls[0].url, 'https://mail.example.test/api/v1/exports?resource=contacts&search=sam%40example.test');
  assert.equal(calls[0].init.headers.get('accept'), 'text/csv');
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer st_live_example');
});
