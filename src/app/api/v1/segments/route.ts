import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { parseSegmentFilters, toSegment, type SegmentRow } from '@/lib/segments';

export const runtime = 'nodejs';
function errorResponse(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }

export async function GET(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const rows = await query<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments ORDER BY updated_at DESC,id DESC');
  return NextResponse.json({ object: 'list', data: await Promise.all(rows.rows.map(toSegment)) });
}

export async function POST(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return errorResponse('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return errorResponse('name must be 1 to 120 single-line characters.', 400);
  const filters = parseSegmentFilters(body.filters);
  if (!filters.ok) return errorResponse(filters.error, 400);
  const id = randomId('seg');
  const timestamp = nowIso();
  try { await execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at) VALUES(?,?,?,?,?)', [id, name, JSON.stringify(filters.filters), timestamp, timestamp]); }
  catch { return errorResponse('A segment with that name already exists.', 409); }
  const row = { id, name, filters_json: JSON.stringify(filters.filters), created_at: timestamp, updated_at: timestamp };
  return NextResponse.json(await toSegment(row), { status: 201 });
}
