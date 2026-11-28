import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';
import { emitWebhookEvent } from '@/lib/webhooks';
import { DEFAULT_WORKSPACE_ID } from './workspaces.ts';

export type SuppressionOrigin = 'manual' | 'bounce' | 'complaint';
export type SuppressionRow = {
  id: string;
  email: string;
  normalized_email: string;
  origin: SuppressionOrigin;
  source_id: string | null;
  created_at: string;
  contact_id?: string | null;
  workspace_id?: string;
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

export async function getSuppression(identifier: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  const normalized = normalizeSuppressionAddress(identifier);
  if (emailAddressPattern.test(normalized)) {
    return queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
      (SELECT c.id FROM contacts c WHERE c.workspace_id=s.workspace_id AND lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
      FROM suppressions s WHERE s.normalized_email=? AND s.workspace_id=?`, [normalized, workspaceId]);
  }
  return queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE c.workspace_id=s.workspace_id AND lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s WHERE s.id=? AND s.workspace_id=?`, [identifier, workspaceId]);
}

export async function listSuppressions(limit: number, after?: SuppressionRow, workspaceId = DEFAULT_WORKSPACE_ID) {
  if (after) {
    return (await query<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
      (SELECT c.id FROM contacts c WHERE c.workspace_id=s.workspace_id AND lower(c.email)=s.normalized_email LIMIT 1) AS contact_id FROM suppressions s
      WHERE s.workspace_id=? AND (s.created_at<? OR (s.created_at=? AND s.id<?)) ORDER BY s.created_at DESC,s.id DESC LIMIT ?`, [workspaceId, after.created_at, after.created_at, after.id, limit])).rows;
  }
  return (await query<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE c.workspace_id=s.workspace_id AND lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s WHERE s.workspace_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT ?`, [workspaceId, limit])).rows;
}

export async function findSuppressedAddresses(addresses: readonly string[], workspaceId = DEFAULT_WORKSPACE_ID) {
  const normalized = [...new Set(addresses.map(normalizeSuppressionAddress))];
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => '?').join(',');
  return (await query<Pick<SuppressionRow, 'id' | 'email' | 'normalized_email' | 'origin' | 'source_id' | 'created_at'>>(
    `SELECT id,email,normalized_email,origin,source_id,created_at FROM suppressions WHERE workspace_id=? AND normalized_email IN (${placeholders})`, [workspaceId, ...normalized],
  )).rows;
}

export async function addSuppression(emailValue: string, origin: SuppressionOrigin = 'manual', sourceId: string | null = null, workspaceId = DEFAULT_WORKSPACE_ID) {
  const email = normalizeSuppressionAddress(emailValue);
  const id = randomId('sup');
  const createdAt = nowIso();
  const inserted = await execute(`INSERT INTO suppressions(id,email,normalized_email,origin,source_id,created_at,workspace_id)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,normalized_email) DO NOTHING`, [id, email, email, origin, sourceId, createdAt, workspaceId]);
  const row = await queryOne<SuppressionRow>(`SELECT s.id,s.email,s.normalized_email,s.origin,s.source_id,s.created_at,
    (SELECT c.id FROM contacts c WHERE c.workspace_id=s.workspace_id AND lower(c.email)=s.normalized_email LIMIT 1) AS contact_id
    FROM suppressions s WHERE s.normalized_email=? AND s.workspace_id=?`, [email, workspaceId]);
  if (inserted && row) await emitSuppressionEvent('suppression.added', row, workspaceId);
  return row;
}

export async function removeSuppression(identifier: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  const row = await getSuppression(identifier, workspaceId);
  if (!row) return null;
  const deleted = await execute('DELETE FROM suppressions WHERE id=? AND workspace_id=?', [row.id, workspaceId]);
  if (!deleted) return null;
  await emitSuppressionEvent('suppression.removed', row, workspaceId);
  return row;
}

export async function emitEmailSuppressed(apiKeyId: string, emailId: string, from: string, recipient: string, subject: string) {
  await emitWebhookEvent(apiKeyId, 'email.suppressed', {
    email_id: emailId,
    from,
    to: [recipient],
    subject,
    suppressed: {
      message: 'Email, thanks skipped sending because the address is on the workspace suppression list.',
      type: 'OnAccountSuppressionList',
    },
  });
}

async function emitSuppressionEvent(type: 'suppression.added' | 'suppression.removed', row: SuppressionRow, workspaceId: string) {
  const keys = (await query<{ id: string }>('SELECT id FROM api_keys WHERE revoked_at IS NULL AND permission=\'full_access\' AND workspace_id=?', [workspaceId])).rows;
  await Promise.all(keys.map(({ id }) => emitWebhookEvent(id, type, {
    id: row.id,
    email: row.email,
    origin: row.origin,
    source_id: row.source_id,
    created_at: row.created_at,
  })));
}
