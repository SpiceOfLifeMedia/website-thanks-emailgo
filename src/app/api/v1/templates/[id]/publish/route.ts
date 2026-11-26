import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { emailTemplateResponse, findEmailTemplate, publishEmailTemplate, storedTemplateToContent } from '@/lib/email-templates';
import { checkEmailLinks } from '@/lib/email-link-checker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: { message: 'Template not found.' } }, { status: 404 });
  const content = storedTemplateToContent(template);
  const linkIssues = checkEmailLinks(content.html, content.text, new Map(content.variables.map((variable) => [variable.key, variable.fallback_value])));
  if (linkIssues.length) return NextResponse.json({ error: { message: 'Review the template links before publishing.' }, link_issues: linkIssues }, { status: 422 });
  const published = await publishEmailTemplate(template);
  if (published === null) return NextResponse.json({ error: { message: 'This template changed while it was being published. Fetch the latest version and retry.' } }, { status: 409 });
  return published ? NextResponse.json(emailTemplateResponse(published)) : NextResponse.json({ error: { message: 'Template not found.' } }, { status: 404 });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
