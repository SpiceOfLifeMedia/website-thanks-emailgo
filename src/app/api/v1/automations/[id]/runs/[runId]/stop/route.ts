import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id, runId } = await context.params;
  const changed = await execute("UPDATE automation_runs SET status='canceled',completed_at=?,updated_at=?,processing_started_at=NULL,error=NULL WHERE id=? AND automation_id=? AND api_key_id=? AND status IN ('running','waiting')", [new Date().toISOString(), new Date().toISOString(), runId, id, key.id]);
  return changed ? NextResponse.json({ id: runId, object: 'automation_run', status: 'canceled' }) : NextResponse.json({ error: { message: 'Only a running or waiting automation run can be stopped.' } }, { status: 409 });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
