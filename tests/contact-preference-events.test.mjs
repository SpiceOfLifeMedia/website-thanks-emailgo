import assert from 'node:assert/strict';
import test from 'node:test';
import { contactTopicPreferenceWebhookEvents, contactUnsubscribeWebhookEvents } from '../src/lib/contact-preference-events.ts';

test('global preference unsubscribe emits a compatible contact update and a stable unsubscribe event', () => {
  const input = {
    contactId: 'contact_1', email: 'person@example.test', emailId: 'email_1',
    unsubscribedAt: '2026-11-27T02:00:00.000Z',
  };
  const events = contactUnsubscribeWebhookEvents(input);
  assert.deepEqual(events.map(({ type }) => type), ['contact.updated', 'contact.unsubscribed']);
  assert.equal(events[0].data.unsubscribed, true);
  assert.equal(events[0].data.unsubscribed_at, input.unsubscribedAt);
  assert.deepEqual(events, contactUnsubscribeWebhookEvents(input));
});

test('topic preference changes emit only the transitions and topics that changed', () => {
  const events = contactTopicPreferenceWebhookEvents({
    contactId: 'contact_1', email: 'person@example.test', emailId: 'email_1',
    changedAt: '2026-11-27T02:00:00.000Z', subscribedTopicIds: ['topic_new'],
    unsubscribedTopicIds: ['topic_old'], consentSource: 'email_preference_center',
  });
  assert.deepEqual(events.map(({ type }) => type), ['contact.subscribed', 'contact.unsubscribed']);
  assert.deepEqual(events[0].data.topic_ids, ['topic_new']);
  assert.deepEqual(events[1].data.topic_ids, ['topic_old']);
  assert.notEqual(events[0].stableEventId, events[1].stableEventId);
});

test('unchanged topic preferences emit no webhook events', () => {
  assert.deepEqual(contactTopicPreferenceWebhookEvents({
    contactId: 'contact_1', email: 'person@example.test', emailId: 'email_1',
    changedAt: '2026-11-27T02:00:00.000Z', subscribedTopicIds: [],
    unsubscribedTopicIds: [], consentSource: 'email_preference_center',
  }), []);
});
