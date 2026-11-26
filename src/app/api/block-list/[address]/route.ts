import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute } from '@/lib/database';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ address: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { address: rawAddress } = await context.params;
  const address = rawAddress.trim().toLowerCase();
  const changes = await execute('DELETE FROM blocked_addresses WHERE address = ?', [address]);
  if (!changes) return NextResponse.json({ error: 'Blocked address not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
