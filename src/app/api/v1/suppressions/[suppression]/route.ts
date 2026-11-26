import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { getSuppression, removeSuppression, suppressionResponse } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ suppression: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: error('This API key has sending-only access.', 403) };
  return { key };
}

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { suppression } = await context.params;
  const row = await getSuppression(suppression);
  return row ? NextResponse.json(suppressionResponse(row), { headers: privateHeaders }) : error('Suppression not found.', 404);
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { suppression } = await context.params;
  const row = await removeSuppression(suppression);
  return row ? NextResponse.json({ object: 'suppression', id: row.id }, { headers: privateHeaders }) : error('Suppression not found.', 404);
}
