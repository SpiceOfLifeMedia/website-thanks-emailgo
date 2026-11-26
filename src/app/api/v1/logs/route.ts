import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { listApiLogs } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const result = await listApiLogs(apiKey.id, new URL(request.url));
  if ('error' in result) return NextResponse.json({ error: { message: result.error } }, { status: 400 });
  return NextResponse.json({ object: 'list', ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
}
