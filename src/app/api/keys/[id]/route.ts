import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { getDatabase, nowIso } from '@/lib/database';
export const runtime = 'nodejs';
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(_request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const result = getDatabase().prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id);
  if (result.changes === 0) return NextResponse.json({ error: 'API key not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
