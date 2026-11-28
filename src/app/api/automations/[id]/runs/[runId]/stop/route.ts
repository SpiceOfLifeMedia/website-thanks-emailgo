import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id, runId } = await context.params;
  const automation = await queryOne<{ api_key_id: string }>('SELECT api_key_id FROM automations WHERE id=?', [id]);
  if (!automation) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  const now = new Date().toISOString();
  const changed = await execute("UPDATE automation_runs SET status='canceled',completed_at=?,updated_at=?,processing_started_at=NULL,error=NULL WHERE id=? AND automation_id=? AND api_key_id=? AND status IN ('running','waiting')", [now, now, runId, id, automation.api_key_id]);
  return changed ? NextResponse.json({ id: runId, status: 'canceled' }) : NextResponse.json({ error: 'Only a running or waiting automation run can be stopped.' }, { status: 409 });
}
