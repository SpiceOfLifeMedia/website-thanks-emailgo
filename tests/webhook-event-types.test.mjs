import assert from 'node:assert/strict';
import test from 'node:test';
import { WEBHOOK_EVENT_TYPES, validateWebhookEvents } from '../src/lib/webhook-event-types.ts';
import { domainWebhookData } from '../src/lib/domain-webhook.ts';
import { buildWebhookEventStatements } from '../src/lib/webhook-event-queue.ts';

test('supports the current core email, contact, and domain lifecycle event names', () => {
  for (const event of [
    'email.scheduled',
    'domain.created',
    'domain.updated',
    'domain.deleted',
  ]) {
    assert.ok(WEBHOOK_EVENT_TYPES.includes(event), `${event} is selectable`);
    assert.deepEqual(validateWebhookEvents([event]), [event]);
  }
});

test('rejects unsupported or duplicate webhook event names', () => {
  assert.equal(validateWebhookEvents(['email.sent', 'email.sent']), null);
  assert.equal(validateWebhookEvents(['domain.verified']), null);
  assert.equal(validateWebhookEvents([]), null);
});

test('domain event data describes the domain without DNS tokens or relay details', () => {
  assert.deepEqual(domainWebhookData({
    id: 'dom_123', domain: 'example.test', created_at: '2026-11-27T00:00:00.000Z',
    verified_at: '2026-11-27T01:00:00.000Z', open_tracking: 1, click_tracking: 0,
  }), {
    id: 'dom_123', name: 'example.test', status: 'verified', created_at: '2026-11-27T00:00:00.000Z',
    open_tracking: true, click_tracking: false,
  });
});

test('inbound webhook delivery statements are stable per event and endpoint', () => {
  const subscriptions = [
    { id: 'wh_received', api_key_id: 'key_a', events_json: '["email.received"]' },
    { id: 'wh_sent', api_key_id: 'key_b', events_json: '["email.sent"]' },
  ];
  const event = {
    type: 'email.received', data: { email_id: 'rx_123' }, stableEventId: 'email.received:source-123',
  };
  const first = buildWebhookEventStatements(subscriptions, [event], '2026-11-27T02:00:00.000Z');
  const retry = buildWebhookEventStatements(subscriptions, [event], '2026-11-27T02:00:00.000Z');
  assert.equal(first.length, 1);
  assert.deepEqual(first, retry);
  assert.equal(first[0].params[2], 'wh_received');
  assert.equal(first[0].params[3], 'key_a');
  assert.equal(JSON.parse(first[0].params[5]).data.email_id, 'rx_123');
  assert.match(first[0].sql, /ON CONFLICT\(id\) DO NOTHING/);
});
