import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { getAutomationByKey, saveAutomation } from '@/lib/automations';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const owner = await queryOne<{ api_key_id: string }>("SELECT api_key_id FROM automations WHERE id=? AND status<>'archived'", [id]);
  if (!owner) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  const current = await getAutomationByKey(owner.api_key_id, id);
  if (!current) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
  const saved = await saveAutomation(owner.api_key_id, id, { ...current, status: 'active' });
  return saved.ok ? NextResponse.json(saved.automation) : NextResponse.json({ error: saved.error }, { status: saved.status });
}
