import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { archiveAutomation, getAutomationByKey, saveAutomation } from '@/lib/automations';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
async function owner(id: string) { return queryOne<{ api_key_id: string }>("SELECT api_key_id FROM automations WHERE id=? AND status<>'archived'", [id]); }

export async function GET(_request: Request, context: Context) {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const row = await owner(id);
  if (!row) return error('Automation not found.', 404);
  const automation = await getAutomationByKey(row.api_key_id, id);
  return automation ? NextResponse.json(automation, { headers: { 'Cache-Control': 'private, no-store' } }) : error('Automation not found.', 404);
}

export async function PATCH(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const parsed = await readJsonLimited(request, 100_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const { id } = await context.params;
  const row = await owner(id);
  if (!row) return error('Automation not found.', 404);
  const saved = await saveAutomation(row.api_key_id, id, parsed.value);
  return saved.ok ? NextResponse.json(saved.automation, { headers: { 'Cache-Control': 'private, no-store' } }) : error(saved.error, saved.status);
}

export async function DELETE(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const row = await owner(id);
  if (!row) return error('Automation not found.', 404);
  const changed = await archiveAutomation(row.api_key_id, id);
  return changed ? NextResponse.json({ id, status: 'archived' }, { headers: { 'Cache-Control': 'private, no-store' } }) : error('Automation not found.', 404);
}
