import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { segmentWhere, type SegmentRow, type SegmentFilters } from '@/lib/segments';

export const runtime = 'nodejs';
type ContactRow = { id: string; email: string; name: string | null; properties_json: string; tags_json: string; unsubscribed_at: string | null; consent_status: 'unknown' | 'opted_in'; consent_source: string | null; consented_at: string | null; created_at: string; updated_at: string };
function errorResponse(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
function toContact(row: ContactRow) {
  let properties: unknown = {};
  let tags: unknown = [];
  try { properties = JSON.parse(row.properties_json); } catch {}
  try { tags = JSON.parse(row.tags_json); } catch {}
  return { id: row.id, object: 'contact', email: row.email, name: row.name, properties, tags, unsubscribed: Boolean(row.unsubscribed_at), consent_status: row.consent_status, consent_source: row.consent_source, consented_at: row.consented_at, ...(row.unsubscribed_at ? { unsubscribed_at: row.unsubscribed_at } : {}), created_at: row.created_at, updated_at: row.updated_at };
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const segment = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments WHERE id=?', [id]);
  if (!segment) return errorResponse('Segment not found.', 404);
  let filters: SegmentFilters;
  try { filters = JSON.parse(segment.filters_json) as SegmentFilters; } catch { return errorResponse('Segment filters are unavailable.', 500); }
  const { where, params } = segmentWhere(filters, id);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let rows: ContactRow[];
  if (after !== null) {
    if (!after) return errorResponse('after must be a non-empty contact ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>(`SELECT c.id,c.created_at FROM contacts c WHERE c.id=? AND ${where}`, [after, ...params]);
    if (!cursor) return errorResponse('after must be a contact ID in this segment.', 400);
    rows = (await query<ContactRow>(`SELECT c.id,c.email,c.name,c.properties_json,c.tags_json,c.unsubscribed_at,c.consent_status,c.consent_source,c.consented_at,c.created_at,c.updated_at FROM contacts c
      WHERE ${where} AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?)) ORDER BY c.created_at DESC,c.id DESC LIMIT ?`, [...params, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<ContactRow>(`SELECT c.id,c.email,c.name,c.properties_json,c.tags_json,c.unsubscribed_at,c.consent_status,c.consent_source,c.consented_at,c.created_at,c.updated_at FROM contacts c WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`, [...params, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(toContact), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
