import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { ensureCurrentTemplateVersion, findEmailTemplate, listEmailTemplateVersions } from '@/lib/email-templates';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  let template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  await ensureCurrentTemplateVersion(template);
  template = await findEmailTemplate(id);
  if (!template) return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  return NextResponse.json({ data: await listEmailTemplateVersions(template) });
}
