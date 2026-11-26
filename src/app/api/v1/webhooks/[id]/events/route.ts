import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeWebhookResource } from '@/lib/webhook-api';
import { listWebhookEvents } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await authorizeWebhookResource(request, id);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const limit = params.has('limit') ? Number(params.get('limit')) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const page = await listWebhookEvents(id, limit, params.get('after'));
  if (!page.ok) return error(page.error, 400);
  return NextResponse.json({ object: 'list', has_more: page.hasMore, data: page.data, ...(page.next_after ? { next_after: page.next_after } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
