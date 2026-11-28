import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { ensureCurrentTemplateVersion, findEmailTemplate, listEmailTemplateVersions } from '@/lib/email-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  let template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: { message: 'Template not found.' } }, { status: 404 });
  await ensureCurrentTemplateVersion(template);
  template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: { message: 'Template not found.' } }, { status: 404 });
  return NextResponse.json({ object: 'list', data: await listEmailTemplateVersions(template) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
