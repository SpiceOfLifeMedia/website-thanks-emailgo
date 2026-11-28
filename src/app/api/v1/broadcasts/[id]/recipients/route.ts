import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { broadcastAnalyticsPage, broadcastRecipientEmail, MAX_BROADCAST_ANALYTICS_EVENTS } from '@/lib/broadcast-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, ...details } }, { status });
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const broadcast = await queryOne<{ id: string }>('SELECT id FROM broadcasts WHERE id=? AND api_key_id=?', [id, key.id]);
  if (!broadcast) return errorResponse('Broadcast not found.', 404);
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (!type) return errorResponse('type is required. Supported values are opened and clicked.', 400);
  if (type !== 'opened' && type !== 'clicked') {
    const unavailable = ['bounced', 'complained', 'delivered', 'unsubscribed'];
    if (unavailable.includes(type)) return errorResponse(`Recipient type "${type}" is unavailable because Email, thanks has no provider event source for it.`, 422, { unavailable_types: unavailable });
    return errorResponse('type must be opened or clicked.', 400);
  }
  const limitValue = params.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  const rows = (await query<{ email_id: string; created_at: string; to_json: string; target_url: string | null; target_domain: string | null; target_path: string | null }>(
    `SELECT ee.email_id,ee.created_at,e.to_json,ee.target_url,ee.target_domain,ee.target_path
      FROM email_events ee JOIN emails e ON e.id=ee.email_id
      WHERE e.broadcast_id=? AND e.api_key_id=? AND ee.type=? ORDER BY ee.created_at,ee.id LIMIT ?`, [id, key.id, `email.${type}`, MAX_BROADCAST_ANALYTICS_EVENTS + 1],
  )).rows;
  if (rows.length > MAX_BROADCAST_ANALYTICS_EVENTS) return errorResponse('This broadcast has too many tracking events for one analytics request. Narrow the event window and retry.', 413, { max_events: MAX_BROADCAST_ANALYTICS_EVENTS });
  const recipients = new Map<string, { email: string; email_id: string; count: number; links: Map<string, number> }>();
  for (const row of rows) {
    let addresses: string[] = [];
    try { addresses = JSON.parse(row.to_json) as string[]; } catch {}
    for (const address of addresses) {
      const email = broadcastRecipientEmail(address);
      if (!email) continue;
      const recipient = recipients.get(email) ?? { email, email_id: row.email_id, count: 0, links: new Map<string, number>() };
      recipient.count += 1;
      if (type === 'clicked') {
        const url = row.target_url ?? (row.target_domain ? `https://${row.target_domain}${row.target_path ?? '/'}` : '');
        if (url) recipient.links.set(url, (recipient.links.get(url) ?? 0) + 1);
      }
      recipients.set(email, recipient);
    }
  }
  const contactEmails = [...recipients.keys()];
  const contactIds = new Map<string, string>();
  for (let offset = 0; offset < contactEmails.length; offset += 500) {
    const batch = contactEmails.slice(offset, offset + 500);
    const placeholders = batch.map(() => '?').join(',');
    const contacts = await query<{ id: string; email: string }>(`SELECT id,email FROM contacts WHERE lower(email) IN (${placeholders})`, batch);
    for (const contact of contacts.rows) contactIds.set(contact.email.toLowerCase(), contact.id);
  }
  const sorted = [...recipients.values()].sort((left, right) => left.email.localeCompare(right.email)).map((recipient) => ({
    cursor_key: recipient.email,
    id: Buffer.from(`recipient:${recipient.email}`).toString('base64url'),
    contact_id: contactIds.get(recipient.email) ?? null,
    email: recipient.email,
    ...(type === 'opened' || type === 'clicked' ? { count: recipient.count } : {}),
    ...(type === 'clicked' ? { clicked_links: [...recipient.links.entries()].map(([url, clicks]) => ({ url, clicks })).sort((left, right) => right.clicks - left.clicks || left.url.localeCompare(right.url)) } : {}),
  }));
  const page = broadcastAnalyticsPage(sorted, limit, params.get('after'), params.get('before'), (row) => row.cursor_key);
  if (!page.ok) return errorResponse(page.error, 400);
  const data = page.data.map(({ cursor_key: _cursorKey, ...row }) => row);
  return NextResponse.json({ object: 'list', has_more: page.hasMore, data, ...(page.next_after ? { next_after: page.next_after } : {}), ...(page.next_before ? { next_before: page.next_before } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
