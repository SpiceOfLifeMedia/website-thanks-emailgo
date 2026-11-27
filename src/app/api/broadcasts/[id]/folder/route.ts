import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { moveBroadcastToFolder } from '@/lib/broadcast-folders';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400, headers: privateHeaders });
  }
  const { id } = await context.params;
  const result = await moveBroadcastToFolder(id, (parsed.value as { folder_id?: unknown }).folder_id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
  return NextResponse.json({ id, folder_id: (parsed.value as { folder_id?: string | null }).folder_id ?? null, updated: true }, { headers: privateHeaders });
}
