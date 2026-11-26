import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Row = { id: string; from_address: string; to_json: string; subject: string; message_id: string | null; received_at: string };

export async function GET(request: Request) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '30');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'limit must be an integer from 1 to 100.' }, { status: 400, headers: privateHeaders });
  const after = url.searchParams.get('after');
  if (after !== null && !after) return NextResponse.json({ error: 'after must be a non-empty received email ID.' }, { status: 400, headers: privateHeaders });
  const total = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM received_emails');
  let rows: Row[];
  if (after) {
    const cursor = await queryOne<{ id: string; received_at: string }>('SELECT id,received_at FROM received_emails WHERE id=?', [after]);
    if (!cursor) return NextResponse.json({ error: 'after must be an existing received email ID.' }, { status: 400, headers: privateHeaders });
    rows = (await query<Row>('SELECT id,from_address,to_json,subject,message_id,received_at FROM received_emails WHERE received_at<? OR (received_at=? AND id<?) ORDER BY received_at DESC,id DESC LIMIT ?', [cursor.received_at, cursor.received_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<Row>('SELECT id,from_address,to_json,subject,message_id,received_at FROM received_emails ORDER BY received_at DESC,id DESC LIMIT ?', [limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((row) => ({ ...row, to: parseArray(row.to_json), to_json: undefined }));
  return NextResponse.json({ object: 'list', data, total: Number(total?.count ?? 0), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) }, { headers: privateHeaders });
}

function parseArray(value: string) {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}
