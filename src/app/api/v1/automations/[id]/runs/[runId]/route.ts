import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { getAutomationRun } from '@/lib/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id, runId } = await context.params;
  const run = await getAutomationRun(key.id, id, runId);
  return run ? NextResponse.json(run, { headers: { 'Cache-Control': 'private, no-store' } }) : NextResponse.json({ error: { message: 'Automation run not found.' } }, { status: 404 });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
