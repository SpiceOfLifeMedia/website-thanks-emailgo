import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { createEmailTemplate, findEmailTemplate, storedTemplateToContent } from '@/lib/email-templates';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const source = await findEmailTemplate(id);
  if (!source) return NextResponse.json({ error: { message: 'Template not found.' } }, { status: 404 });

  let body: { name?: unknown } | undefined;
  if (request.body && request.headers.get('content-length') !== '0') {
    const parsed = await readJsonLimited(request, 10_000);
    if (!parsed.ok) return NextResponse.json({ error: { message: parsed.error } }, { status: parsed.status });
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: { message: 'Request body must be a JSON object.' } }, { status: 400 });
    body = parsed.value as { name?: unknown };
  }
  if (body?.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) return NextResponse.json({ error: { message: 'name must be 1 to 120 characters.' } }, { status: 400 });

  try {
    const content = { ...storedTemplateToContent(source), name: typeof body?.name === 'string' ? body.name.trim() : `Copy of ${source.name}`, alias: null };
    const duplicate = await createEmailTemplate(content);
    return duplicate ? NextResponse.json({ id: duplicate.id, object: 'template' }, { status: 201 }) : NextResponse.json({ error: { message: 'The template could not be duplicated.' } }, { status: 500 });
  } catch {
    return NextResponse.json({ error: { message: 'A template with that name already exists.' } }, { status: 409 });
  }
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
