import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { listAutomationsForDashboard, saveAutomation } from '@/lib/automations';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function GET() {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  return NextResponse.json({ data: await listAutomationsForDashboard() }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const parsed = await readJsonLimited(request, 100_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (typeof body.api_key_id !== 'string') return error('Select an active full-access API key.', 400);
  const key = await queryOne<{ id: string }>("SELECT id FROM api_keys WHERE id=? AND permission='full_access' AND revoked_at IS NULL", [body.api_key_id]);
  if (!key) return error('Select an active full-access API key.', 400);
  const saved = await saveAutomation(key.id, null, body);
  return saved.ok ? NextResponse.json(saved.automation, { status: 201, headers: { 'Cache-Control': 'private, no-store' } }) : error(saved.error, saved.status);
}
