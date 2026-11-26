import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { getSuppression, removeSuppression } from '@/lib/suppressions';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ address: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { address } = await context.params;
  const row = await getSuppression(address);
  if (!row) return NextResponse.json({ error: 'Blocked address not found.' }, { status: 404 });
  if (row.origin !== 'manual') return NextResponse.json({ error: 'Delivery-related block entries cannot be removed here.' }, { status: 409 });
  const removed = await removeSuppression(row.id);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Blocked address could not be removed.' }, { status: 500 });
}
