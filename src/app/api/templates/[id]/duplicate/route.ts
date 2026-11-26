import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { createEmailTemplate, emailTemplateResponse, findEmailTemplate, storedTemplateToContent } from '@/lib/email-templates';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const source = await findEmailTemplate(id);
  if (!source) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });

  let name = `Copy of ${source.name}`;
  if (request.body) {
    const parsed = await readJsonLimited(request, 10_000);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    const candidate = (parsed.value as { name?: unknown }).name;
    if (candidate !== undefined) {
      if (typeof candidate !== 'string' || !candidate.trim() || candidate.trim().length > 120) return NextResponse.json({ error: 'Name must be 1 to 120 characters.' }, { status: 400 });
      name = candidate.trim();
    }
  }

  try {
    const duplicate = await createEmailTemplate({ ...storedTemplateToContent(source), name, alias: null });
    return duplicate ? NextResponse.json(emailTemplateResponse(duplicate), { status: 201 }) : NextResponse.json({ error: 'The template could not be duplicated.' }, { status: 500 });
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists.' }, { status: 409 });
  }
}
