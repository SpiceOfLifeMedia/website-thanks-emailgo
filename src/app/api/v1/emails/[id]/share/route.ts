import { NextResponse } from 'next/server';
import { withApiRequestLog } from '@/lib/request-logs';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { createEmailShare } from '@/lib/email-shares';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };

async function __emailgo_POST_handler(request: Request, context: Context) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: { message: parsed.error } }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: { message: 'Request body must be a JSON object.' } }, { status: 400, headers: privateHeaders });
  const body = parsed.value as Record<string, unknown>;
  const hasSnake = Object.hasOwn(body, 'expires_in');
  const hasCamel = Object.hasOwn(body, 'expiresIn');
  if (hasSnake && hasCamel || Object.keys(body).some((key) => key !== 'expires_in' && key !== 'expiresIn')) return NextResponse.json({ error: { message: 'Provide only expires_in.' } }, { status: 400, headers: privateHeaders });
  const { id } = await context.params;
  const result = await createEmailShare(id, hasSnake ? body.expires_in : body.expiresIn, apiKey.id);
  if ('error' in result) return NextResponse.json({ error: { message: result.error } }, { status: result.status, headers: privateHeaders });
  return NextResponse.json({ object: 'email', id: result.id, url: result.url, share_id: result.shareId, expires_at: result.expiresAt }, { status: 201, headers: privateHeaders });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
