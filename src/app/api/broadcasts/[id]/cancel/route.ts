import { NextResponse } from 'next/server';
import { authorizeBroadcastRequest } from '@/lib/broadcasts';
import { execute, queryOne, transaction } from '@/lib/database';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const { id } = await context.params;
  const campaign = await queryOne<{ status: string }>('SELECT status FROM broadcasts WHERE id=?', [id]);
  if (!campaign) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: privateHeaders });
  if (!['queued', 'scheduled', 'sending'].includes(campaign.status)) return NextResponse.json({ error: 'Only queued or scheduled broadcasts can be canceled.' }, { status: 409, headers: privateHeaders });
  const inFlight = await queryOne<{ count: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS count FROM emails WHERE broadcast_id=? AND status='processing'", [id]);
  if (Number(inFlight?.count ?? 0) > 0) return NextResponse.json({ error: 'Email delivery is already in progress. Retry canceling after the worker finishes.' }, { status: 409, headers: privateHeaders });
  const timestamp = new Date().toISOString();
  await transaction([
    { sql: "UPDATE emails SET status='canceled',next_attempt_at=NULL,attachment_payload_json=NULL WHERE broadcast_id=? AND status='scheduled'", params: [id] },
    { sql: "UPDATE broadcasts SET status='canceled',updated_at=? WHERE id=? AND status IN ('queued','scheduled','sending')", params: [timestamp, id] },
  ]);
  const canceled = await queryOne<{ count: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS count FROM emails WHERE broadcast_id=? AND status='canceled'", [id]);
  return NextResponse.json({ id, status: 'canceled', canceled_count: Number(canceled?.count ?? 0) }, { headers: privateHeaders });
}
