import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const email = await queryOne<{ id: string }>('SELECT id FROM emails WHERE id=? AND api_key_id=?', [id, apiKey.id]);
  if (!email) return NextResponse.json({ error: { message: 'Email not found.' } }, { status: 404 });
  const url = new URL(request.url);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 50 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return NextResponse.json({ error: { message: 'limit must be an integer from 1 to 500.' } }, { status: 400 });
  const after = url.searchParams.get('after');
  let rows: Array<Record<string, unknown>>;
  if (after !== null) {
    if (!after) return NextResponse.json({ error: { message: 'after must be a non-empty event ID.' } }, { status: 400 });
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM email_events WHERE id=? AND email_id=?', [after, id]);
    if (!cursor) return NextResponse.json({ error: { message: 'after must be an event ID for this email.' } }, { status: 400 });
    rows = (await query(`SELECT id,type,created_at,target_domain,target_path FROM email_events WHERE email_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [id, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query(`SELECT id,type,created_at,target_domain,target_path FROM email_events WHERE email_id=? ORDER BY created_at DESC,id DESC LIMIT ?`, [id, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data, has_more: hasMore, ...(hasMore ? { next_after: data[data.length - 1]?.id } : {}) });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
