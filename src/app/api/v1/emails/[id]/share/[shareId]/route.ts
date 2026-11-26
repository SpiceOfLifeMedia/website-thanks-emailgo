import { NextResponse } from 'next/server';
import { withApiRequestLog } from '@/lib/request-logs';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { revokeEmailShare } from '@/lib/email-shares';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string; shareId: string }> };

async function __emailgo_DELETE_handler(request: Request, context: Context) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id, shareId } = await context.params;
  if (!await revokeEmailShare(id, shareId, apiKey.id)) return NextResponse.json({ error: { message: 'Email share link not found.' } }, { status: 404, headers: privateHeaders });
  return NextResponse.json({ object: 'email', id, share_id: shareId, deleted: true }, { headers: privateHeaders });
}

export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
