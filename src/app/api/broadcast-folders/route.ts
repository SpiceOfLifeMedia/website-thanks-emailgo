import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { createBroadcastFolder, listBroadcastFolders } from '@/lib/broadcast-folders';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  return NextResponse.json({ data: await listBroadcastFolders() }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400, headers: privateHeaders });
  }
  const result = await createBroadcastFolder((parsed.value as { name?: unknown }).name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
  return NextResponse.json({ data: result.folder }, { status: 201, headers: privateHeaders });
}
