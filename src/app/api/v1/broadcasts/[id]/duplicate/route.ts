import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { duplicateBroadcast } from '@/lib/broadcast-duplicate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const duplicateId = await duplicateBroadcast(key.id, id);
  if (!duplicateId) return errorResponse('Broadcast not found.', 404);
  return NextResponse.json({ object: 'broadcast', id: duplicateId }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
