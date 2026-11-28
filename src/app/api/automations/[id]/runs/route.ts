import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const automation = await queryOne<{ api_key_id: string }>("SELECT api_key_id FROM automations WHERE id=? AND status<>'archived'", [id]);
  if (!automation) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '30');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'limit must be an integer from 1 to 100.' }, { status: 400 });
  const rows = await query<{ id: string; event_id: string; event_name: string; contact_id: string | null; email: string | null; status: string; current_step_key: string | null; started_at: string; updated_at: string; completed_at: string | null; error: string | null }>('SELECT id,event_id,event_name,contact_id,email,status,current_step_key,started_at,updated_at,completed_at,error FROM automation_runs WHERE automation_id=? AND api_key_id=? ORDER BY started_at DESC,id DESC LIMIT ?', [id, automation.api_key_id, limit]);
  return NextResponse.json({ data: rows.rows }, { headers: { 'Cache-Control': 'private, no-store' } });
}
