import { createHash } from 'node:crypto';
import type { DeliveryEvent } from '@/lib/ses-events';
import type { WebhookEventType } from '@/lib/webhooks';

export type DeliveryWebhookEmail = {
  id: string;
  from_address: string;
  subject: string;
  message_id: string | null;
  broadcast_id: string | null;
};

const deliveryWebhookTypes: Record<DeliveryEvent['type'], WebhookEventType> = {
  delivered: 'email.delivered',
  deferred: 'email.delivery_delayed',
  bounced: 'email.bounced',
  complained: 'email.complained',
};

export function deliveryWebhookType(type: DeliveryEvent['type']) {
  return deliveryWebhookTypes[type];
}

export function deliveryWebhookEventId(snsMessageId: string, event: DeliveryEvent) {
  const identity = `${snsMessageId}\0${event.type}\0${event.recipient}`;
  return `evt_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

export function deliveryWebhookData(event: DeliveryEvent, email: DeliveryWebhookEmail) {
  return {
    email_id: email.id,
    ...(email.broadcast_id ? { broadcast_id: email.broadcast_id } : {}),
    from: email.from_address,
    to: [event.recipient],
    subject: email.subject,
    ...(email.message_id ? { message_id: email.message_id } : {}),
    ...(event.bounce ? { bounce: { type: event.bounce.type, subType: event.bounce.subType } } : {}),
    ...(event.complaint ? { complaint: { feedbackType: event.complaint.feedbackType } } : {}),
  };
}
