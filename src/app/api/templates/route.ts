import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TemplateBody = { name?: unknown; subject?: unknown; html?: unknown; text?: unknown };
function isTemplateContent(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function validateTemplate(body: TemplateBody) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const html = body.html === undefined ? null : body.html;
  const text = body.text === undefined ? null : body.text;
  if (!name || name.length > 120) return { error: 'Name must be 1 to 120 characters.' };
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) return { error: 'Subject must be 1 to 998 characters and cannot contain line breaks.' };
  if (!isTemplateContent(html) || !isTemplateContent(text)) return { error: 'HTML and text content must be strings.' };
  if ((html?.length ?? 0) > 100_000 || (text?.length ?? 0) > 100_000) return { error: 'Template content must not exceed 100 KB per format.' };
  if (!html?.trim() && !text?.trim()) return { error: 'Provide HTML content, text content or both.' };
  return { value: { name, subject, html, text } };
}

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const templates = await query('SELECT id,name,subject,html,text,created_at,updated_at FROM email_templates ORDER BY updated_at DESC LIMIT 200');
  return NextResponse.json({ data: templates.rows });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 250_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const validated = validateTemplate(parsed.value as TemplateBody);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const id = randomId('tpl');
  const timestamp = nowIso();
  try {
    await execute('INSERT INTO email_templates(id,name,subject,html,text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id, validated.value.name, validated.value.subject, validated.value.html, validated.value.text, timestamp, timestamp]);
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists.' }, { status: 409 });
  }
  return NextResponse.json({ id, ...validated.value, created_at: timestamp, updated_at: timestamp }, { status: 201 });
}
