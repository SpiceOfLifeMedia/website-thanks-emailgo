import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query } from '@/lib/database';
import { segmentWhere, type SegmentFilters, type SegmentRow } from '@/lib/segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const availableMetrics = ['all_contacts', 'subscribers', 'unsubscribers'] as const;
const metricSet = new Set<string>(availableMetrics);
const MAX_SEGMENTS_PER_REQUEST = 100;

type ContactCounts = { all_contacts: number | string; subscribers: number | string; unsubscribers: number | string };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function parseList(params: URLSearchParams, key: string) {
  return params.getAll(key).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

async function countContacts(where = '', values: Array<string | number | null> = []) {
  const rows = await query<ContactCounts>(`SELECT CAST(COUNT(*) AS INTEGER) AS all_contacts,
      CAST(COALESCE(SUM(CASE WHEN c.unsubscribed_at IS NULL THEN 1 ELSE 0 END),0) AS INTEGER) AS subscribers,
      CAST(COALESCE(SUM(CASE WHEN c.unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS INTEGER) AS unsubscribers
    FROM contacts c${where ? ` WHERE ${where}` : ''}`, values);
  const row = rows.rows[0];
  return Object.fromEntries(availableMetrics.map((metric) => [metric, Number(row?.[metric] ?? 0)]));
}

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);

  const params = new URL(request.url).searchParams;
  const requestedMetrics = parseList(params, 'metrics');
  const metrics = requestedMetrics.length ? [...new Set(requestedMetrics)] : [...availableMetrics];
  const invalidMetrics = metrics.filter((metric) => !metricSet.has(metric));
  if (invalidMetrics.length) return errorResponse(`Unknown metric: ${invalidMetrics.join(', ')}.`, 400);

  const requestedDimensions = parseList(params, 'dimensions');
  const dimensions = [...new Set(requestedDimensions)];
  const invalidDimensions = dimensions.filter((dimension) => dimension !== 'segment');
  if (invalidDimensions.length) return errorResponse(`Unknown dimension: ${invalidDimensions.join(', ')}.`, 400);

  const requestedSegmentIds = [...new Set(parseList(params, 'segment_id'))];
  if (requestedSegmentIds.length > MAX_SEGMENTS_PER_REQUEST) return errorResponse(`segment_id may contain up to ${MAX_SEGMENTS_PER_REQUEST} values.`, 400);

  let segments: SegmentRow[] = [];
  if (dimensions.includes('segment') || requestedSegmentIds.length) {
    if (requestedSegmentIds.length) {
      const placeholders = requestedSegmentIds.map(() => '?').join(',');
      segments = (await query<SegmentRow>(`SELECT id,name,filters_json,created_at,updated_at FROM segments WHERE id IN (${placeholders})`, requestedSegmentIds)).rows
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      if (segments.length !== requestedSegmentIds.length) return errorResponse('One or more segments were not found.', 404);
    } else {
      segments = (await query<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments ORDER BY created_at DESC,id DESC LIMIT ?', [MAX_SEGMENTS_PER_REQUEST + 1])).rows;
      if (segments.length > MAX_SEGMENTS_PER_REQUEST) return errorResponse(`Segment dimension is limited to ${MAX_SEGMENTS_PER_REQUEST} segments per request. Add segment_id filters.`, 413);
    }
  }

  let totals: Record<string, number>;
  if (requestedSegmentIds.length) {
    const segmentFilters: Array<{ where: string; params: Array<string | number | null> }> = [];
    for (const segment of segments) {
      let filters: SegmentFilters;
      try { filters = JSON.parse(segment.filters_json) as SegmentFilters; }
      catch { return errorResponse('A requested segment has invalid saved filters.', 500); }
      segmentFilters.push(segmentWhere(filters, segment.id));
    }
    const where = segmentFilters.map(({ where }) => `(${where})`).join(' OR ');
    const values = segmentFilters.flatMap(({ params: values }) => values);
    totals = await countContacts(`(${where})`, values);
  } else {
    totals = await countContacts();
  }

  const data = dimensions.includes('segment') ? await Promise.all(segments.map(async (segment) => {
    let filters: SegmentFilters;
    try { filters = JSON.parse(segment.filters_json) as SegmentFilters; }
    catch { throw new Error('A segment has invalid saved filters.'); }
    const membership = segmentWhere(filters, segment.id);
    const counts = await countContacts(membership.where, membership.params);
    return { id: segment.id, name: segment.name, ...Object.fromEntries(metrics.map((metric) => [metric, counts[metric]])) };
  })) : undefined;

  return NextResponse.json({
    object: 'metrics',
    metrics,
    dimensions,
    totals: Object.fromEntries(metrics.map((metric) => [metric, totals[metric]])),
    ...(data ? { data } : {}),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
