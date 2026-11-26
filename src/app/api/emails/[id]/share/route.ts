import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { createEmailShare } from '@/lib/email-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400, headers: privateHeaders });
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'expires_in')) return NextResponse.json({ error: 'Provide only expires_in.' }, { status: 400, headers: privateHeaders });
  const { id } = await context.params;
  const result = await createEmailShare(id, body.expires_in);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
  return NextResponse.json({ id: result.id, share_id: result.shareId, url: result.url, expires_at: result.expiresAt }, { status: 201, headers: privateHeaders });
}
