import { nowIso, queryOne, transaction } from '@/lib/database';
import { createContactPreferenceToken, verifyContactPreferenceToken } from '@/lib/contact-preference-token';
import { contactUnsubscribeWebhookEvents } from '@/lib/contact-preference-events';
import { webhookEventStatements } from '@/lib/webhooks';
import type { WebhookEventInput } from '@/lib/webhook-event-queue';

export { createContactPreferenceToken, verifyContactPreferenceToken };

export async function contactPreferenceWebhookStatements(emailId: string | undefined, events: readonly WebhookEventInput[]) {
  if (!emailId || !events.length) return [];
  const source = await queryOne<{ api_key_id: string }>('SELECT api_key_id FROM emails WHERE id=?', [emailId]);
  if (!source) return [];
  return webhookEventStatements(source.api_key_id, events);
}

export async function unsubscribeContact(contactId: string, emailId?: string) {
  const timestamp = nowIso();
  const source = emailId
    ? await queryOne<{ api_key_id: string; email: string; unsubscribed_at: string | null }>(
      'SELECT e.api_key_id,c.email,c.unsubscribed_at FROM emails e JOIN contacts c ON c.id=? WHERE e.id=?',
      [contactId, emailId],
    )
    : undefined;
  const unsubscribedAt = source?.unsubscribed_at ?? timestamp;
  const webhookStatements = source && emailId
    ? await webhookEventStatements(source.api_key_id, contactUnsubscribeWebhookEvents({
      contactId,
      email: source.email,
      emailId,
      unsubscribedAt,
    }))
    : [];
  const statements = [
    { sql: 'UPDATE contacts SET unsubscribed_at=COALESCE(unsubscribed_at,?),updated_at=? WHERE id=?', params: [timestamp, timestamp, contactId] },
    { sql: 'UPDATE contact_topics SET unsubscribed_at=? WHERE contact_id=? AND unsubscribed_at IS NULL', params: [timestamp, contactId] },
  ];
  if (emailId) statements.push({
    sql: "INSERT INTO email_events(id,email_id,type,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
    params: [`unsubscribe:${emailId}`, emailId, 'email.unsubscribed', timestamp],
  });
  await transaction([...statements, ...webhookStatements]);
  return timestamp;
}
