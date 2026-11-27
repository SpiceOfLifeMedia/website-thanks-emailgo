import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { moveTemplateToFolder } from '@/lib/template-folders';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const folderId = (parsed.value as { folder_id?: unknown }).folder_id;
  if (folderId !== null && typeof folderId !== 'string') return NextResponse.json({ error: 'folder_id must be a folder ID or null.' }, { status: 400 });
  const { id } = await context.params;
  const result = await moveTemplateToFolder(id, folderId as string | null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id, folder_id: folderId }, { headers: { 'Cache-Control': 'private, no-store' } });
}
