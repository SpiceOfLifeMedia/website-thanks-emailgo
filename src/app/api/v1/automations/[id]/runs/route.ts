import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

async function __emailgo_GET_handler(request: Request, context: Context) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  if (!await queryOne<{ id: string }>("SELECT id FROM automations WHERE id=? AND api_key_id=? AND status<>'archived'", [id, key.id])) return NextResponse.json({ error: { message: 'Automation not found.' } }, { status: 404 });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '30');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: { message: 'limit must be an integer from 1 to 100.' } }, { status: 400 });
  const after = url.searchParams.get('after');
  let rows;
  if (after) {
    const cursor = await queryOne<{ id: string; started_at: string }>('SELECT id,started_at FROM automation_runs WHERE id=? AND automation_id=? AND api_key_id=?', [after, id, key.id]);
    if (!cursor) return NextResponse.json({ error: { message: 'after must identify a run in this automation.' } }, { status: 400 });
    rows = await query<{ id: string; event_id: string; event_name: string; contact_id: string | null; email: string | null; status: string; current_step_key: string | null; started_at: string; updated_at: string; completed_at: string | null; error: string | null }>(`SELECT id,event_id,event_name,contact_id,email,status,current_step_key,started_at,updated_at,completed_at,error FROM automation_runs
      WHERE automation_id=? AND api_key_id=? AND (started_at<? OR (started_at=? AND id<?)) ORDER BY started_at DESC,id DESC LIMIT ?`, [id, key.id, cursor.started_at, cursor.started_at, cursor.id, limit + 1]);
  } else rows = await query<{ id: string; event_id: string; event_name: string; contact_id: string | null; email: string | null; status: string; current_step_key: string | null; started_at: string; updated_at: string; completed_at: string | null; error: string | null }>('SELECT id,event_id,event_name,contact_id,email,status,current_step_key,started_at,updated_at,completed_at,error FROM automation_runs WHERE automation_id=? AND api_key_id=? ORDER BY started_at DESC,id DESC LIMIT ?', [id, key.id, limit + 1]);
  const hasMore = rows.rows.length > limit;
  const data = rows.rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data, has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
