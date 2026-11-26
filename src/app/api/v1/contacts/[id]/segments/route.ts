import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { segmentWhere, type SegmentFilters, type SegmentRow } from '@/lib/segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const contact = await queryOne<{ id: string }>('SELECT id FROM contacts WHERE id=? OR lower(email)=lower(?) LIMIT 1', [id, id]);
  if (!contact) return error('Contact not found.', 404);
  const rows = await query<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments ORDER BY created_at DESC,id DESC');
  const data: Array<{ id: string; name: string; created_at: string }> = [];
  for (const segment of rows.rows) {
    let filters: SegmentFilters;
    try { filters = JSON.parse(segment.filters_json) as SegmentFilters; } catch { continue; }
    const condition = segmentWhere(filters, segment.id);
    const member = await queryOne<{ id: string }>(`SELECT c.id FROM contacts c WHERE c.id=? AND ${condition.where}`, [contact.id, ...condition.params]);
    if (member) data.push({ id: segment.id, name: segment.name, created_at: segment.created_at });
  }
  return NextResponse.json({ object: 'list', data, has_more: false }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
