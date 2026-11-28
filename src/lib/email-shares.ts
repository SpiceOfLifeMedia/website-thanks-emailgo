import { randomBytes } from 'node:crypto';
import { execute, hashSecret, nowIso, queryOne, randomId } from '@/lib/database';
import { shareExpirationMs, sharePublicOrigin } from '@/lib/email-share-policy';

const SENT_SHARE_STATES = ['sent', 'delivered', 'deferred', 'bounced', 'complained'];
const SHARE_TOKEN_PATTERN = /^shr_live_[A-Za-z0-9_-]{43}$/;

export type ShareEmail = {
  id: string;
  shareId: string;
  url: string;
  expiresAt: string;
};

export type SharedEmailContent = {
  id: string;
  emailType: 'sent' | 'received';
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  sentAt: string;
  expiresAt: string;
  hasAttachments: boolean;
};

function parseAddresses(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export async function createEmailShare(emailId: string, expiresIn: unknown, ownerApiKeyId?: string): Promise<ShareEmail | { error: string; status: number }> {
  const origin = sharePublicOrigin(process.env.EMAILGO_PUBLIC_URL, process.env.NODE_ENV === 'production');
  if (!origin) return { error: 'Set EMAILGO_PUBLIC_URL to the canonical HTTPS address for this workspace before creating share links.', status: 503 };
  const duration = shareExpirationMs(expiresIn);
  if (duration === null) return { error: 'expires_in must be a duration no longer than 48 hours, such as 10m, 2 hours, or 1 day.', status: 400 };

  const ownerClause = ownerApiKeyId ? ' AND api_key_id=?' : '';
  const sentParams: Array<string> = [emailId, ...SENT_SHARE_STATES, ...(ownerApiKeyId ? [ownerApiKeyId] : [])];
  const sent = await queryOne<{ id: string; api_key_id: string }>(`SELECT id,api_key_id FROM emails WHERE id=? AND status IN (${SENT_SHARE_STATES.map(() => '?').join(',')})${ownerClause}`, sentParams);
  const received = sent ? undefined : await queryOne<{ id: string; api_key_id: string }>(`SELECT id,api_key_id FROM received_emails WHERE id=?${ownerClause}`, [emailId, ...(ownerApiKeyId ? [ownerApiKeyId] : [])]);
  const source = sent ? { ...sent, emailType: 'sent' as const } : received ? { ...received, emailType: 'received' as const } : undefined;
  if (!source) return { error: 'Sent or received email not found.', status: 404 };

  const token = `shr_live_${randomBytes(32).toString('base64url')}`;
  const shareId = randomId('share');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + duration).toISOString();
  await execute(`INSERT INTO email_share_links(id,token_hash,api_key_id,email_id,email_type,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?)`, [shareId, hashSecret(token), source.api_key_id, emailId, source.emailType, expiresAt, createdAt]);
  const url = new URL('/share', origin);
  url.hash = token;
  return { id: emailId, shareId, url: url.toString(), expiresAt };
}

export async function revokeEmailShare(emailId: string, shareId: string, ownerApiKeyId?: string) {
  const ownerClause = ownerApiKeyId ? ' AND api_key_id=?' : '';
  const share = await queryOne<{ id: string; revoked_at: string | null }>(`SELECT id,revoked_at FROM email_share_links WHERE id=? AND email_id=?${ownerClause}`,
    [shareId, emailId, ...(ownerApiKeyId ? [ownerApiKeyId] : [])]);
  if (!share) return false;
  if (!share.revoked_at) await execute('UPDATE email_share_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL', [nowIso(), shareId]);
  return true;
}

export async function readSharedEmail(token: string): Promise<SharedEmailContent | null> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const share = await queryOne<{ id: string; api_key_id: string; email_id: string; email_type: string; expires_at: string }>(`SELECT id,api_key_id,email_id,email_type,expires_at FROM email_share_links
    WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`, [hashSecret(token), nowIso()]);
  if (!share || (share.email_type !== 'sent' && share.email_type !== 'received')) return null;

  if (share.email_type === 'sent') {
    const email = await queryOne<{ id: string; from_address: string; to_json: string; cc_json: string | null; subject: string; text_body: string | null; html_body: string | null; created_at: string; attachments_json: string | null }>(`SELECT id,from_address,to_json,cc_json,subject,text_body,html_body,created_at,attachments_json FROM emails WHERE id=? AND api_key_id=?`, [share.email_id, share.api_key_id]);
    if (!email) return null;
    let hasAttachments = false;
    try { const attachments: unknown = JSON.parse(email.attachments_json ?? '[]'); hasAttachments = Array.isArray(attachments) && attachments.length > 0; } catch { /* Malformed metadata is treated as absent. */ }
    return { id: email.id, emailType: 'sent', from: email.from_address, to: parseAddresses(email.to_json), cc: parseAddresses(email.cc_json), subject: email.subject, text: email.text_body, html: email.html_body, sentAt: email.created_at, expiresAt: share.expires_at, hasAttachments };
  }

  const email = await queryOne<{ id: string; from_address: string; to_json: string; cc_json: string | null; subject: string; text_body: string | null; html_body: string | null; received_at: string }>(`SELECT id,from_address,to_json,cc_json,subject,text_body,html_body,received_at FROM received_emails WHERE id=? AND api_key_id=?`, [share.email_id, share.api_key_id]);
  if (!email) return null;
  const attachments = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM received_email_attachments WHERE received_email_id=?', [email.id]);
  return { id: email.id, emailType: 'received', from: email.from_address, to: parseAddresses(email.to_json), cc: parseAddresses(email.cc_json), subject: email.subject, text: email.text_body, html: email.html_body, sentAt: email.received_at, expiresAt: share.expires_at, hasAttachments: Number(attachments?.count ?? 0) > 0 };
}
