import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { createEmailTemplate, emailTemplateResponse, emailTemplateSummaryResponse, listEmailTemplates, validateTemplateRequest } from '@/lib/email-templates';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const templates = await listEmailTemplates();
  return NextResponse.json({ data: templates.slice(0, 200).map(emailTemplateSummaryResponse) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 250_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const validated = validateTemplateRequest(parsed.value);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const template = await createEmailTemplate(validated.content);
    if (!template) return NextResponse.json({ error: 'The template could not be created.' }, { status: 500 });
    return NextResponse.json({ ...emailTemplateResponse(template) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists.' }, { status: 409 });
  }
}
