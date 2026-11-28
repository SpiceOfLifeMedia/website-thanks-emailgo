import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeWebhookResource } from '@/lib/webhook-api';
import { replayWebhookEvent } from '@/lib/webhook-events';

export const runtime = 'nodejs';
async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await context.params;
  const auth = await authorizeWebhookResource(request, id);
  if (auth.response) return auth.response;
  if (auth.webhook.disabled_at) return NextResponse.json({ error: { message: 'Webhook must be enabled before replaying an event.' } }, { status: 409 });
  const replay = await replayWebhookEvent(id, eventId);
  if (!replay) return NextResponse.json({ error: { message: 'Webhook event not found.' } }, { status: 404 });
  return NextResponse.json({ object: 'webhook_event', id: replay.event_id, status: replay.status, replayed: replay.replayed }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
