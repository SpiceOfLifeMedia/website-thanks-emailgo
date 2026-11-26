import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { getAutomationRun } from '@/lib/automations';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id, runId } = await context.params;
  const automation = await queryOne<{ api_key_id: string }>('SELECT api_key_id FROM automations WHERE id=?', [id]);
  if (!automation) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  const run = await getAutomationRun(automation.api_key_id, id, runId);
  return run ? NextResponse.json(run, { headers: { 'Cache-Control': 'private, no-store' } }) : NextResponse.json({ error: 'Automation run not found.' }, { status: 404 });
}
