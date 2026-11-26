import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 2_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value) || typeof (parsed.value as { delivery_id?: unknown }).delivery_id !== 'string') return error('delivery_id is required.', 400);
  const deliveryId = (parsed.value as { delivery_id: string }).delivery_id;
  const webhook = await queryOne<{ id: string }>('SELECT id FROM webhooks WHERE id=? AND api_key_id=?', [id, apiKey.id]);
  if (!webhook) return error('Webhook not found.', 404);
  const row = await queryOne<{ id: string; event_id: string; status: string }>('SELECT id,event_id,status FROM webhook_deliveries WHERE id=? AND webhook_id=?', [deliveryId, id]);
  if (!row) return error('Delivery not found.', 404);
  if (row.status === 'processing' || row.status === 'pending') return error('Only delivered or failed webhook deliveries can be replayed.', 409);
  const updated = await execute(`UPDATE webhook_deliveries SET status='pending',attempt_count=0,next_attempt_at=NULL,last_error=NULL,
    last_status_code=NULL,last_response_excerpt=NULL,processing_started_at=NULL,delivered_at=NULL WHERE id=? AND webhook_id=? AND status=?`, [deliveryId, id, row.status]);
  return updated ? NextResponse.json({ id: deliveryId, event_id: row.event_id, status: 'pending', replayed: true }) : error('Delivery changed while it was being replayed. Refresh and try again.', 409);
}
