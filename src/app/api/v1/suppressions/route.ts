import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { addSuppression, isValidSuppressionAddress, listSuppressions, suppressionResponse, type SuppressionRow } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: error('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let cursor: SuppressionRow | undefined;
  if (after !== null) {
    if (!after) return error('after must be a non-empty suppression ID.', 400);
    cursor = await queryOne<SuppressionRow>('SELECT id,email,normalized_email,origin,source_id,created_at FROM suppressions WHERE id=? AND workspace_id=?', [after, auth.key.workspaceId]);
    if (!cursor) return error('after must be an existing suppression ID.', 400);
  }
  const rows = await listSuppressions(limit + 1, cursor, auth.key.workspaceId);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(suppressionResponse), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) }, { headers: privateHeaders });
}

async function __emailgo_POST_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const email = (parsed.value as Record<string, unknown>).email;
  if (!isValidSuppressionAddress(email)) return error('email must be a valid email address.', 400);
  const row = await addSuppression(email, 'manual', null, auth.key.workspaceId);
  if (!row) return error('The suppression could not be saved.', 500);
  return NextResponse.json({ object: 'suppression', id: row.id }, { status: 201, headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
