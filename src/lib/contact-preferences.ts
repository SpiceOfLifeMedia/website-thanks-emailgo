import { createHmac, timingSafeEqual } from 'node:crypto';
import { nowIso, transaction } from '@/lib/database';

type ContactPreferenceIdentity = { contactId: string; email: string };

function signingSecret() {
  const secret = process.env.EMAILGO_PREFERENCES_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function createContactPreferenceToken(identity: ContactPreferenceIdentity) {
  const secret = signingSecret();
  if (!secret) throw new Error('EMAILGO_PREFERENCES_SECRET must contain at least 32 characters.');
  const payload = Buffer.from(JSON.stringify(identity)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`emailgo:preferences:v1\0${payload}`).digest('base64url');
  return `v1.${payload}.${signature}`;
}

export function verifyContactPreferenceToken(token: string): ContactPreferenceIdentity | null {
  const secret = signingSecret();
  if (!secret || token.length > 2048) return null;
  const [version, payload, signature, ...extra] = token.split('.');
  if (version !== 'v1' || !payload || !signature || extra.length) return null;
  const expected = createHmac('sha256', secret).update(`emailgo:preferences:v1\0${payload}`).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const identity = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ContactPreferenceIdentity>;
    if (typeof identity.contactId !== 'string' || identity.contactId.length > 100 || typeof identity.email !== 'string' || identity.email.length > 254) return null;
    return { contactId: identity.contactId, email: identity.email };
  } catch { return null; }
}

export async function unsubscribeContact(contactId: string) {
  const timestamp = nowIso();
  await transaction([
    { sql: 'UPDATE contacts SET unsubscribed_at=COALESCE(unsubscribed_at,?),updated_at=? WHERE id=?', params: [timestamp, timestamp, contactId] },
    { sql: 'UPDATE contact_topics SET unsubscribed_at=? WHERE contact_id=? AND unsubscribed_at IS NULL', params: [timestamp, contactId] },
  ]);
  return timestamp;
}
