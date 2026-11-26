import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { addSuppression, isValidSuppressionAddress, listSuppressions, suppressionResponse, type SuppressionRow } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

export async function GET(request: Request) {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const rows = await listSuppressions(100_001);
    if (rows.length > 100_000) return error('The suppression export exceeds 100,000 rows. Use the paginated API.', 413);
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = ['email,origin,source_id,created_at', ...rows.map((row) => [row.email, row.origin, row.source_id ?? '', row.created_at].map(quote).join(','))].join('\r\n');
    return new Response(csv, { headers: { ...privateHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="emailgo-suppressions.csv"' } });
  }
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let cursor: SuppressionRow | undefined;
  if (after !== null) {
    if (!after) return error('after must be a non-empty suppression ID.', 400);
    cursor = await queryOne<SuppressionRow>('SELECT id,email,normalized_email,origin,source_id,created_at FROM suppressions WHERE id=?', [after]);
    if (!cursor) return error('after must be an existing suppression ID.', 400);
  }
  const rows = await listSuppressions(limit + 1, cursor);
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(suppressionResponse), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const email = (parsed.value as Record<string, unknown>).email;
  if (!isValidSuppressionAddress(email)) return error('email must be a valid email address.', 400);
  const row = await addSuppression(email);
  return row ? NextResponse.json(suppressionResponse(row), { status: 201, headers: privateHeaders }) : error('The suppression could not be saved.', 500);
}
