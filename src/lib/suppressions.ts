import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';
import { emitWebhookEvent } from '@/lib/webhooks';

export type SuppressionOrigin = 'manual' | 'bounce' | 'complaint';
export type SuppressionRow = {
  id: string;
  email: string;
  normalized_email: string;
  origin: SuppressionOrigin;
  source_id: string | null;
  created_at: string;
  contact_id?: string | null;
};

export const emailAddressPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export function normalizeSuppressionAddress(value: string) {
  const trimmed = value.trim();
  const mailbox = /<([^<>]+)>$/.exec(trimmed)?.[1] ?? trimmed;
  return mailbox.trim().toLowerCase();
}

export function isValidSuppressionAddress(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 254 && emailAddressPattern.test(value.trim());
}

export function suppressionResponse(row: SuppressionRow) {
  return {
    id: row.id,
    object: 'suppression',
    email: row.email,
    ...(row.contact_id ? { contact_id: row.contact_id } : {}),
    origin: row.origin,
    source_id: row.source_id,
    created_at: row.created_at,
  };
}

export async function getSuppression(identifier: string) {
  const normalized = normalizeSuppressionAddress(identifier);
  if (emailAddressPattern.test(normalized)) {
    return queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
      (SELECT c.id FROM contacts c WHERE lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
      FROM suppressions s WHERE s.normalized_email=?`, [normalized]);
  }
  return queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s WHERE s.id=?`, [identifier]);
}

export async function listSuppressions(limit: number, after?: SuppressionRow) {
  if (after) {
    return (await query<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
      (SELECT c.id FROM contacts c WHERE lower(c.email)=s.normalized_email LIMIT 1) AS contact_id FROM suppressions s
      WHERE s.created_at<? OR (s.created_at=? AND s.id<?) ORDER BY s.created_at DESC,s.id DESC LIMIT ?`, [after.created_at, after.created_at, after.id, limit])).rows;
  }
  return (await query<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s ORDER BY s.created_at DESC,s.id DESC LIMIT ?`, [limit])).rows;
}

export async function findSuppressedAddresses(addresses: readonly string[]) {
  const normalized = [...new Set(addresses.map(normalizeSuppressionAddress))];
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => '?').join(',');
  return (await query<Pick<SuppressionRow, 'id' | 'email' | 'normalized_email' | 'origin' | 'source_id' | 'created_at'>>(
    `SELECT id,email,normalized_email,origin,source_id,created_at FROM suppressions WHERE normalized_email IN (${placeholders})`, normalized,
  )).rows;
}

export async function addSuppression(emailValue: string, origin: SuppressionOrigin = 'manual', sourceId: string | null = null) {
  const email = normalizeSuppressionAddress(emailValue);
  const id = randomId('sup');
  const createdAt = nowIso();
  const inserted = await execute(`INSERT INTO suppressions(id,email,normalized_email,origin,source_id,created_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(normalized_email) DO NOTHING`, [id, email, email, origin, sourceId, createdAt]);
  const row = await queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s WHERE s.normalized_email=?`, [email]);
  if (inserted && row) await emitSuppressionEvent('suppression.added', row);
  return row;
}

export async function removeSuppression(identifier: string) {
  const row = await getSuppression(identifier);
  if (!row) return null;
  const deleted = await execute('DELETE FROM suppressions WHERE id=?', [row.id]);
  if (!deleted) return null;
  await emitSuppressionEvent('suppression.removed', row);
  return row;
}

export async function emitEmailSuppressed(apiKeyId: string, emailId: string, from: string, recipient: string, subject: string) {
  await emitWebhookEvent(apiKeyId, 'email.suppressed', {
    email_id: emailId,
    from,
    to: [recipient],
    subject,
    suppressed: {
      message: 'Send, thanks skipped sending because the address is on the workspace suppression list.',
      type: 'OnAccountSuppressionList',
    },
  });
}

async function emitSuppressionEvent(type: 'suppression.added' | 'suppression.removed', row: SuppressionRow) {
  const keys = (await query<{ id: string }>('SELECT id FROM api_keys WHERE revoked_at IS NULL AND permission=\'full_access\'')).rows;
  await Promise.all(keys.map(({ id }) => emitWebhookEvent(id, type, {
    id: row.id,
    email: row.email,
    origin: row.origin,
    source_id: row.source_id,
    created_at: row.created_at,
  })));
}
