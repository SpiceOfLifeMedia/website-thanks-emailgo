import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const exists = await queryOne<{ id: string }>('SELECT id FROM webhooks WHERE id=?', [id]);
  if (!exists) return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 });
  const rows = await query(`SELECT id,event_id,event_type,status,attempt_count,created_at,last_attempt_at,last_status_code,last_error,delivered_at
    FROM webhook_deliveries WHERE webhook_id=? ORDER BY created_at DESC,id DESC LIMIT 50`, [id]);
  const ids = rows.rows.map((row) => String(row.id));
  const attempts = ids.length ? await query(`SELECT delivery_id,attempt_number,attempted_at,duration_ms,status_code,response_excerpt,error_message
    FROM webhook_delivery_attempts WHERE delivery_id IN (${ids.map(() => '?').join(',')}) ORDER BY attempt_number ASC`, ids) : { rows: [] };
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const attempt of attempts.rows) {
    const deliveryId = String(attempt.delivery_id);
    grouped.set(deliveryId, [...(grouped.get(deliveryId) ?? []), attempt]);
  }
  return NextResponse.json({ data: rows.rows.map((row) => ({ ...row, attempts: grouped.get(String(row.id)) ?? [] })) });
}
