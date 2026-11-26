import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { createEmailTemplate, emailTemplateSummaryResponse, listEmailTemplatePage, validateTemplateRequest } from '@/lib/email-templates';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);

  const url = new URL(request.url);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  const after = url.searchParams.get('after');
  const before = url.searchParams.get('before');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  if (after && before) return errorResponse('Use either after or before, not both.', 400);

  const result = await listEmailTemplatePage(limit, after, before);
  if (!result.ok) return errorResponse(result.error, 400);
  const data = result.data;
  return NextResponse.json({
    object: 'list',
    data: data.map(emailTemplateSummaryResponse),
    has_more: result.hasMore,
    ...(result.hasMore && before ? { next_before: data[0]?.id } : {}),
    ...(result.hasMore && !before ? { next_after: data.at(-1)?.id } : {}),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_POST_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 700_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  const validated = validateTemplateRequest(parsed.value, undefined, true);
  if (!validated.ok) return errorResponse(validated.error, 400);
  try {
    const template = await createEmailTemplate(validated.content);
    if (!template) return errorResponse('The template could not be created.', 500);
    return NextResponse.json({ id: template.id, object: 'template' }, { status: 201 });
  } catch {
    return errorResponse('A template with that name or alias already exists.', 409);
  }
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
