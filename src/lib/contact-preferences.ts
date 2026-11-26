import { nowIso, transaction } from '@/lib/database';
import { createContactPreferenceToken, verifyContactPreferenceToken } from '@/lib/contact-preference-token';

export { createContactPreferenceToken, verifyContactPreferenceToken };

export async function unsubscribeContact(contactId: string, emailId?: string) {
  const timestamp = nowIso();
  const statements = [
    { sql: 'UPDATE contacts SET unsubscribed_at=COALESCE(unsubscribed_at,?),updated_at=? WHERE id=?', params: [timestamp, timestamp, contactId] },
    { sql: 'UPDATE contact_topics SET unsubscribed_at=? WHERE contact_id=? AND unsubscribed_at IS NULL', params: [timestamp, contactId] },
  ];
  if (emailId) statements.push({
    sql: "INSERT INTO email_events(id,email_id,type,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
    params: [`unsubscribe:${emailId}`, emailId, 'email.unsubscribed', timestamp],
  });
  await transaction(statements);
  return timestamp;
}
