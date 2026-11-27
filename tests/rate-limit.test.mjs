import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRateLimitHeaders, apiRateLimitState, withApiRateLimitHeaders } from '../src/lib/rate-limit.ts';

test('one-second workspace limits report remaining requests and reset time', () => {
  const state = apiRateLimitState(4, 10, 120_000);
  assert.deepEqual(state, { limit: 10, remaining: 6, resetAtMs: 121_000, allowed: true });
  assert.deepEqual(apiRateLimitHeaders(state, 120_250), {
    'ratelimit-limit': '10',
    'ratelimit-remaining': '6',
    'ratelimit-reset': '1',
  });
});

test('exhausted API limits return zero remaining and a retry-after value', () => {
  const state = apiRateLimitState(11, 10, 120_000);
  assert.deepEqual(apiRateLimitHeaders(state, 120_500), {
    'ratelimit-limit': '10',
    'ratelimit-remaining': '0',
    'ratelimit-reset': '1',
    'retry-after': '1',
  });
});

test('rate limit response headers preserve the response body and status', async () => {
  const response = new Response(JSON.stringify({ error: { message: 'Rate limited.' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  const limited = withApiRateLimitHeaders(response, apiRateLimitState(11, 10, 120_000), 120_000);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('content-type'), 'application/json');
  assert.equal(limited.headers.get('ratelimit-remaining'), '0');
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.deepEqual(await limited.json(), { error: { message: 'Rate limited.' } });
});
