import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeWebhookResource } from '@/lib/webhook-api';
import { getWebhookEvent } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await context.params;
  const auth = await authorizeWebhookResource(request, id);
  if (auth.response) return auth.response;
  const event = await getWebhookEvent(id, eventId);
  if (!event) return NextResponse.json({ error: { message: 'Webhook event not found.' } }, { status: 404 });
  return NextResponse.json(event, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
