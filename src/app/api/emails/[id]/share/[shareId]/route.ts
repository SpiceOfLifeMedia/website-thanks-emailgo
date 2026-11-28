import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { revokeEmailShare } from '@/lib/email-shares';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string; shareId: string }> };

export async function DELETE(request: Request, context: Context) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  const { id, shareId } = await context.params;
  if (!await revokeEmailShare(id, shareId)) return NextResponse.json({ error: 'Email share link not found.' }, { status: 404, headers: privateHeaders });
  return NextResponse.json({ id, share_id: shareId, deleted: true }, { headers: privateHeaders });
}
