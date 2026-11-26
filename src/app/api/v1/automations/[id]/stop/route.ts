import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { getAutomationByKey, saveAutomation } from '@/lib/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const current = await getAutomationByKey(key.id, id);
  if (!current) return NextResponse.json({ error: { message: 'Automation not found.' } }, { status: 404 });
  const saved = await saveAutomation(key.id, id, { status: 'paused' });
  return saved.ok ? NextResponse.json(saved.automation) : NextResponse.json({ error: { message: saved.error } }, { status: saved.status });
}
