import assert from 'node:assert/strict';
import test from 'node:test';
import { sendRateLimitHeaders, sendRateLimitState, withSendRateLimitHeaders } from '../src/lib/rate-limit.ts';

test('fixed-window send limits report the remaining requests and reset time', () => {
  const state = sendRateLimitState(12, 60, 120_000);
  assert.deepEqual(state, { limit: 60, remaining: 48, resetAtMs: 180_000, allowed: true });
  assert.deepEqual(sendRateLimitHeaders(state, 121_250), {
    'ratelimit-limit': '60',
    'ratelimit-remaining': '48',
    'ratelimit-reset': '59',
  });
});

test('exhausted send limits return zero remaining and a retry-after value', () => {
  const state = sendRateLimitState(61, 60, 120_000);
  assert.deepEqual(sendRateLimitHeaders(state, 179_500), {
    'ratelimit-limit': '60',
    'ratelimit-remaining': '0',
    'ratelimit-reset': '1',
    'retry-after': '1',
  });
});

test('rate limit response headers preserve the response body and status', async () => {
  const response = new Response(JSON.stringify({ error: { message: 'Rate limited.' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  const limited = withSendRateLimitHeaders(response, sendRateLimitState(61, 60, 120_000), 120_000);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('content-type'), 'application/json');
  assert.equal(limited.headers.get('ratelimit-remaining'), '0');
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.deepEqual(await limited.json(), { error: { message: 'Rate limited.' } });
});
