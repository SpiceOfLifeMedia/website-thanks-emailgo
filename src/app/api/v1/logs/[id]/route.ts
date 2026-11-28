import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { getApiLog } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const log = await getApiLog(id);
  if (!log) return NextResponse.json({ error: { message: 'Log not found.' } }, { status: 404 });
  return NextResponse.json(log, { headers: { 'Cache-Control': 'private, no-store' } });
}
