import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { createTemplateFolder, listTemplateFolders } from '@/lib/template-folders';

export const runtime = 'nodejs';

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  return NextResponse.json({ data: await listTemplateFolders() }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const input = parsed.value as { name?: unknown; parent_id?: unknown };
  const result = await createTemplateFolder({ name: input.name, parent_id: input.parent_id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ data: result.folder }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
