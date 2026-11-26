import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type ReceivedEmailRow = { id: string; from_address: string; to_json: string; subject: string; message_id: string | null; received_at: string };

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

export async function GET(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let rows: ReceivedEmailRow[];
  if (after !== null) {
    if (!after) return error('after must be a non-empty received email ID.', 400);
    const cursor = await queryOne<{ id: string; received_at: string }>('SELECT id,received_at FROM received_emails WHERE id=? AND api_key_id=?', [after, key.id]);
    if (!cursor) return error('after must be an existing received email ID.', 400);
    rows = (await query<ReceivedEmailRow>(`SELECT id,from_address,to_json,subject,message_id,received_at FROM received_emails WHERE api_key_id=? AND (received_at<? OR (received_at=? AND id<?)) ORDER BY received_at DESC,id DESC LIMIT ?`, [key.id, cursor.received_at, cursor.received_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<ReceivedEmailRow>('SELECT id,from_address,to_json,subject,message_id,received_at FROM received_emails WHERE api_key_id=? ORDER BY received_at DESC,id DESC LIMIT ?', [key.id, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map((row) => ({ id: row.id, object: 'received_email', from: row.from_address, to: jsonArray(row.to_json), subject: row.subject, message_id: row.message_id, received_at: row.received_at })), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) }, { headers: privateHeaders });
}

function jsonArray(value: string | undefined) {
  if (!value) return [];
  try { return JSON.parse(value) as string[]; } catch { return []; }
}
