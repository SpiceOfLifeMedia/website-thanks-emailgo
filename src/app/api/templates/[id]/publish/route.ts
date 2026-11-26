import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { emailTemplateResponse, findEmailTemplate, publishEmailTemplate, storedTemplateToContent } from '@/lib/email-templates';
import { checkEmailLinks } from '@/lib/email-link-checker';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  const content = storedTemplateToContent(template);
  const linkIssues = checkEmailLinks(content.html, content.text, new Map(content.variables.map((variable) => [variable.key, variable.fallback_value])));
  if (linkIssues.length) return NextResponse.json({ error: 'Review the template links before publishing.', link_issues: linkIssues }, { status: 422 });
  const published = await publishEmailTemplate(template);
  return published ? NextResponse.json(emailTemplateResponse(published)) : NextResponse.json({ error: 'Template not found.' }, { status: 404 });
}
