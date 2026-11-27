import type { WebhookEventInput } from '@/lib/webhook-event-queue';

type UnsubscribeInput = {
  contactId: string;
  email: string;
  emailId: string;
  unsubscribedAt: string;
};

type TopicPreferenceInput = {
  contactId: string;
  email: string;
  emailId: string;
  changedAt: string;
  subscribedTopicIds: string[];
  unsubscribedTopicIds: string[];
  consentSource: string;
};

function stableId(type: string, emailId: string, contactId: string, changedAt: string) {
  return `contact-preference:${type}:${emailId}:${contactId}:${changedAt}`;
}

export function contactUnsubscribeWebhookEvents(input: UnsubscribeInput): WebhookEventInput[] {
  const data = {
    contact_id: input.contactId,
    email: input.email,
    unsubscribed: true,
    unsubscribed_at: input.unsubscribedAt,
  };
  return [
    {
      type: 'contact.updated',
      data,
      stableEventId: stableId('updated', input.emailId, input.contactId, input.unsubscribedAt),
    },
    {
      type: 'contact.unsubscribed',
      data,
      stableEventId: stableId('unsubscribed', input.emailId, input.contactId, input.unsubscribedAt),
    },
  ];
}

export function contactTopicPreferenceWebhookEvents(input: TopicPreferenceInput): WebhookEventInput[] {
  const events: WebhookEventInput[] = [];
  if (input.subscribedTopicIds.length) {
    events.push({
      type: 'contact.subscribed',
      data: {
        contact_id: input.contactId,
        email: input.email,
        topic_ids: input.subscribedTopicIds,
        consent_source: input.consentSource,
        consented_at: input.changedAt,
      },
      stableEventId: stableId('subscribed', input.emailId, input.contactId, input.changedAt),
    });
  }
  if (input.unsubscribedTopicIds.length) {
    events.push({
      type: 'contact.unsubscribed',
      data: {
        contact_id: input.contactId,
        email: input.email,
        topic_ids: input.unsubscribedTopicIds,
        unsubscribed_at: input.changedAt,
      },
      stableEventId: stableId('unsubscribed', input.emailId, input.contactId, input.changedAt),
    });
  }
  return events;
}
