import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const hook = await queryOne<{ id: string }>('SELECT id FROM webhooks WHERE id=? AND api_key_id=?', [id, apiKey.id]);
  if (!hook) return error('Webhook not found.', 404);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let rows: Array<Record<string, unknown>>;
  if (after !== null) {
    if (!after) return error('after must be a non-empty delivery ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM webhook_deliveries WHERE id=? AND webhook_id=?', [after, id]);
    if (!cursor) return error('after must be a delivery ID for this webhook.', 400);
    rows = (await query(`SELECT id,event_id,event_type,status,attempt_count,created_at,last_attempt_at,last_status_code,last_error,delivered_at FROM webhook_deliveries
      WHERE webhook_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [id, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query('SELECT id,event_id,event_type,status,attempt_count,created_at,last_attempt_at,last_status_code,last_error,delivered_at FROM webhook_deliveries WHERE webhook_id=? ORDER BY created_at DESC,id DESC LIMIT ?', [id, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const ids = data.map((row) => String(row.id));
  const attempts = ids.length ? await query(`SELECT delivery_id,attempt_number,attempted_at,duration_ms,status_code,response_excerpt,error_message
    FROM webhook_delivery_attempts WHERE delivery_id IN (${ids.map(() => '?').join(',')}) ORDER BY attempt_number ASC`, ids) : { rows: [] };
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const attempt of attempts.rows) {
    const deliveryId = String(attempt.delivery_id);
    grouped.set(deliveryId, [...(grouped.get(deliveryId) ?? []), attempt]);
  }
  const dataWithAttempts = data.map((row) => ({ ...row, attempts: grouped.get(String(row.id)) ?? [] }));
  return NextResponse.json({ object: 'list', data: dataWithAttempts, has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
