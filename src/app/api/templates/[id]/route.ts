import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';

type Template = { id: string; name: string; subject: string; html: string | null; text: string | null; created_at: string; updated_at: string };
type TemplateBody = { name?: unknown; subject?: unknown; html?: unknown; text?: unknown };

function validateTemplate(body: TemplateBody) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const html = body.html === undefined ? null : body.html;
  const text = body.text === undefined ? null : body.text;
  if (!name || name.length > 120) return { error: 'Name must be 1 to 120 characters.' };
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) return { error: 'Subject must be 1 to 998 characters and cannot contain line breaks.' };
  if (!(html === null || typeof html === 'string') || !(text === null || typeof text === 'string')) return { error: 'HTML and text content must be strings.' };
  if ((typeof html === 'string' ? html.length : 0) > 100_000 || (typeof text === 'string' ? text.length : 0) > 100_000) return { error: 'Template content must not exceed 100 KB per format.' };
  if (!(typeof html === 'string' && html.trim()) && !(typeof text === 'string' && text.trim())) return { error: 'Provide HTML content, text content or both.' };
  return { value: { name, subject, html: html as string | null, text: text as string | null } };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const template = await queryOne<Template>('SELECT id,name,subject,html,text,created_at,updated_at FROM email_templates WHERE id=?', [id]);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  return NextResponse.json(template);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const current = await queryOne<Template>('SELECT id,name,subject,html,text,created_at,updated_at FROM email_templates WHERE id=?', [id]);
  if (!current) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  const parsed = await readJsonLimited(request, 250_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as TemplateBody;
  const validated = validateTemplate({
    name: body.name === undefined ? current.name : body.name,
    subject: body.subject === undefined ? current.subject : body.subject,
    html: body.html === undefined ? current.html : body.html,
    text: body.text === undefined ? current.text : body.text,
  });
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const updatedAt = nowIso();
  try {
    await execute('UPDATE email_templates SET name=?,subject=?,html=?,text=?,updated_at=? WHERE id=?', [validated.value.name, validated.value.subject, validated.value.html, validated.value.text, updatedAt, id]);
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists.' }, { status: 409 });
  }
  return NextResponse.json({ ...current, ...validated.value, updated_at: updatedAt });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const deleted = await execute('DELETE FROM email_templates WHERE id=?', [id]);
  if (!deleted) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  return NextResponse.json({ id, deleted: true });
}
