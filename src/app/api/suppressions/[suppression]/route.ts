import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { getSuppression, removeSuppression, suppressionResponse } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ suppression: string }> };
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

export async function GET(request: Request, context: Context) {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { suppression } = await context.params;
  const row = await getSuppression(suppression);
  return row ? NextResponse.json(suppressionResponse(row), { headers: privateHeaders }) : error('Suppression not found.', 404);
}

export async function DELETE(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { suppression } = await context.params;
  const row = await removeSuppression(suppression);
  return row ? NextResponse.json({ object: 'suppression', id: row.id }, { headers: privateHeaders }) : error('Suppression not found.', 404);
}
