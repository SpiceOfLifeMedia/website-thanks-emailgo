import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { emailTemplateResponse, findEmailTemplate, saveEmailTemplateDraft, storedTemplateToContent, validateTemplateRequest } from '@/lib/email-templates';
import { execute } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  return NextResponse.json(emailTemplateResponse(template));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const current = await findEmailTemplate(id);
  if (!current) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  const parsed = await readJsonLimited(request, 250_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const validated = validateTemplateRequest(parsed.value, storedTemplateToContent(current));
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const updated = await saveEmailTemplateDraft(id, validated.content, current.current_version_id ?? '');
    if (updated === null) return NextResponse.json({ error: 'This template changed while you were editing it. Reload it and apply your changes again.' }, { status: 409 });
    return updated ? NextResponse.json(emailTemplateResponse(updated)) : NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists.' }, { status: 409 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  const deleted = await execute('DELETE FROM email_templates WHERE id=?', [template.id]);
  if (!deleted) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  return NextResponse.json({ id: template.id, deleted: true });
}
