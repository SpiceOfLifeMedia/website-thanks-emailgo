import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const rows = await query<{ event_name: string; last_seen_at: string; count: number }>('SELECT event_name,MAX(created_at) AS last_seen_at,COUNT(*) AS count FROM automation_events WHERE api_key_id=? GROUP BY event_name ORDER BY last_seen_at DESC LIMIT 100', [key.id]);
  return NextResponse.json({ object: 'list', data: rows.rows }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
