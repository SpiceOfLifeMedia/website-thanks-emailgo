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
  const limitValue = params.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  const rows = (await query<{ email_id: string; to_json: string; target_url: string | null; target_domain: string | null; target_path: string | null }>(
    `SELECT ee.email_id,e.to_json,ee.target_url,ee.target_domain,ee.target_path
      FROM email_events ee JOIN emails e ON e.id=ee.email_id
      WHERE e.broadcast_id=? AND e.api_key_id=? AND ee.type='email.clicked' ORDER BY ee.created_at,ee.id LIMIT ?`, [id, key.id, MAX_BROADCAST_ANALYTICS_EVENTS + 1],
  )).rows;
  if (rows.length > MAX_BROADCAST_ANALYTICS_EVENTS) return errorResponse('This broadcast has too many tracking events for one analytics request. Narrow the event window and retry.', 413, { max_events: MAX_BROADCAST_ANALYTICS_EVENTS });
  const links = new Map<string, { clicks: number; recipients: Set<string> }>();
  for (const row of rows) {
    const url = row.target_url ?? (row.target_domain ? `https://${row.target_domain}${row.target_path ?? '/'}` : '');
    if (!url) continue;
    let recipients: string[] = [];
    try { recipients = JSON.parse(row.to_json) as string[]; } catch {}
    const link = links.get(url) ?? { clicks: 0, recipients: new Set<string>() };
    link.clicks += 1;
    for (const address of recipients) link.recipients.add(broadcastRecipientEmail(address));
    links.set(url, link);
  }
  const sorted = [...links.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([url, values]) => ({
    cursor_key: url,
    id: Buffer.from(`url:${url}`).toString('base64url'), url, clicks: values.clicks, unique_clicks: values.recipients.size,
  }));
  const page = broadcastAnalyticsPage(sorted, limit, params.get('after'), params.get('before'), (row) => row.cursor_key);
  if (!page.ok) return errorResponse(page.error, 400);
  const data = page.data.map(({ cursor_key: _cursorKey, ...row }) => row);
  return NextResponse.json({ object: 'list', has_more: page.hasMore, data, ...(page.next_after ? { next_after: page.next_after } : {}), ...(page.next_before ? { next_before: page.next_before } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
