import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { deleteTemplateFolder } from '@/lib/template-folders';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const deleted = await deleteTemplateFolder(id);
  return deleted
    ? NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    : NextResponse.json({ error: 'Folder not found.' }, { status: 404 });
}
