import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string; deliveryId: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id, deliveryId } = await context.params;
  const hook = await queryOne<{ id: string; disabled_at: string | null }>('SELECT id,disabled_at FROM webhooks WHERE id=?', [id]);
  if (!hook || hook.disabled_at) return NextResponse.json({ error: 'Active webhook not found.' }, { status: 404 });
  const delivery = await queryOne<{ id: string; status: string; event_id: string }>('SELECT id,status,event_id FROM webhook_deliveries WHERE id=? AND webhook_id=?', [deliveryId, id]);
  if (!delivery) return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 });
  if (delivery.status === 'processing' || delivery.status === 'pending') return NextResponse.json({ error: 'Only delivered or failed events can be replayed.' }, { status: 409 });
  const changed = await execute(`UPDATE webhook_deliveries SET status='pending',attempt_count=0,next_attempt_at=NULL,last_error=NULL,
    last_status_code=NULL,last_response_excerpt=NULL,processing_started_at=NULL,delivered_at=NULL WHERE id=? AND webhook_id=? AND status=?`, [deliveryId, id, delivery.status]);
  return changed ? NextResponse.json({ id: deliveryId, event_id: delivery.event_id, status: 'pending', replayed: true }) : NextResponse.json({ error: 'Delivery changed while it was being replayed.' }, { status: 409 });
}
