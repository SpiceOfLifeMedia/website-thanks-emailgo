import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { listAutomationsByKey, saveAutomation } from '@/lib/automations';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function GET(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const data = await listAutomationsByKey(key.id);
  return NextResponse.json({ object: 'list', data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 100_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const saved = await saveAutomation(key.id, null, parsed.value);
  if (!saved.ok) return error(saved.error, saved.status);
  return NextResponse.json(saved.automation, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
