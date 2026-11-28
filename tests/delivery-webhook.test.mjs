import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryWebhookData, deliveryWebhookEventId, deliveryWebhookType } from '../src/lib/delivery-webhook.ts';

test('maps recipient delivery outcomes to documented email webhook event types', () => {
  assert.equal(deliveryWebhookType('delivered'), 'email.delivered');
  assert.equal(deliveryWebhookType('deferred'), 'email.delivery_delayed');
  assert.equal(deliveryWebhookType('bounced'), 'email.bounced');
  assert.equal(deliveryWebhookType('complained'), 'email.complained');
});

test('creates a stable event identity for each notification and recipient', () => {
  const event = { type: 'bounced', relayMessageId: 'relay-1', recipient: 'person@example.test', suppress: true, detail: 'Permanent / General' };
  assert.equal(deliveryWebhookEventId('notice-1', event), deliveryWebhookEventId('notice-1', event));
  assert.notEqual(deliveryWebhookEventId('notice-1', event), deliveryWebhookEventId('notice-2', event));
  assert.notEqual(deliveryWebhookEventId('notice-1', event), deliveryWebhookEventId('notice-1', { ...event, recipient: 'other@example.test' }));
});

test('builds an outcome payload with exactly the affected recipient', () => {
  const event = {
    type: 'bounced', relayMessageId: 'relay-1', recipient: 'person@example.test', suppress: true,
    detail: 'Permanent / General', bounce: { type: 'Permanent', subType: 'General' },
  };
  const email = { id: 'em_1', from_address: 'hello@example.test', subject: 'Hello', message_id: '<message@example.test>', broadcast_id: 'br_1' };
  assert.deepEqual(deliveryWebhookData(event, email), {
    email_id: 'em_1', broadcast_id: 'br_1', from: 'hello@example.test', to: ['person@example.test'],
    subject: 'Hello', message_id: '<message@example.test>', bounce: { type: 'Permanent', subType: 'General' },
  });
});
