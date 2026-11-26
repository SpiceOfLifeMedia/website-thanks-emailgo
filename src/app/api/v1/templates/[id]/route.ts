import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { emailTemplateResponse, ensureCurrentTemplateVersion, findEmailTemplate, saveEmailTemplateDraft, storedTemplateToContent, validateTemplateRequest } from '@/lib/email-templates';
import { execute, query, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  let template = await findEmailTemplate(id);
  if (template) {
    await ensureCurrentTemplateVersion(template);
    template = await findEmailTemplate(id);
  }
  return template ? NextResponse.json(emailTemplateResponse(template), { headers: { 'Cache-Control': 'private, no-store' } }) : errorResponse('Template not found.', 404);
}

async function __emailgo_PATCH_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const current = await findEmailTemplate(id);
  if (!current) return errorResponse('Template not found.', 404);
  const parsed = await readJsonLimited(request, 700_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  const validated = validateTemplateRequest(parsed.value, storedTemplateToContent(current));
  if (!validated.ok) return errorResponse(validated.error, 400);
  try {
    const updated = await saveEmailTemplateDraft(current.id, validated.content, current.current_version_id ?? '');
    if (updated === null) return errorResponse('This template changed since it was read. Fetch the latest version and retry your update.', 409);
    return updated ? NextResponse.json(emailTemplateResponse(updated)) : errorResponse('Template not found.', 404);
  } catch {
    return errorResponse('A template with that name or alias already exists.', 409);
  }
}

async function __emailgo_DELETE_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const template = await findEmailTemplate(id);
  if (!template) return errorResponse('Template not found.', 404);
  const storedReference = await queryOne<{ automation_id: string }>('SELECT automation_id FROM automation_template_refs WHERE template_id=? LIMIT 1', [template.id]);
  if (storedReference) return errorResponse('This template is used by an automation. Remove the reference before deleting it.', 409);
  const automationRows = (await query<{ steps_json: string }>('SELECT steps_json FROM automations')).rows;
  const referencedByAutomation = automationRows.some(({ steps_json }) => {
    try {
      const steps: unknown = JSON.parse(steps_json);
      return Array.isArray(steps) && steps.some((step) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
        const record = step as { type?: unknown; config?: unknown };
        if (record.type !== 'send_email' || !record.config || typeof record.config !== 'object' || Array.isArray(record.config)) return false;
        const config = record.config as { template?: unknown };
        return Boolean(config.template && typeof config.template === 'object' && !Array.isArray(config.template)
          && (config.template as { id?: unknown }).id === template.id);
      });
    } catch { return true; }
  });
  if (referencedByAutomation) return errorResponse('This template is used by an automation. Remove the reference before deleting it.', 409);
  try {
    const deleted = await execute('DELETE FROM email_templates WHERE id=? AND NOT EXISTS (SELECT 1 FROM automation_template_refs WHERE template_id=?)', [template.id, template.id]);
    if (!deleted) return errorResponse('This template became linked to an automation. Remove the reference before deleting it.', 409);
  } catch (cause) {
    const error = cause && typeof cause === 'object' ? cause as { code?: unknown; errcode?: unknown } : {};
    if (error.code === '23503' || error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || error.errcode === 787) return errorResponse('This template became linked to an automation. Remove the reference before deleting it.', 409);
    throw cause;
  }
  return NextResponse.json({ id: template.id, object: 'template' });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
