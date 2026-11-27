export const WEBHOOK_EVENT_TYPES = [
  'email.sent', 'email.failed', 'email.suppressed', 'email.scheduled', 'email.opened', 'email.clicked', 'email.received',
  'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained',
  'contact.created', 'contact.updated', 'contact.deleted', 'contact.subscribed', 'contact.unsubscribed',
  'suppression.added', 'suppression.removed',
  'domain.created', 'domain.updated', 'domain.deleted',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];

export function validateWebhookEvents(value: unknown): WebhookEventType[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > WEBHOOK_EVENT_TYPES.length) return null;
  if (value.some((item) => typeof item !== 'string' || !WEBHOOK_EVENT_TYPES.includes(item as WebhookEventType))) return null;
  const events = [...new Set(value as WebhookEventType[])];
  return events.length === value.length ? events : null;
}
