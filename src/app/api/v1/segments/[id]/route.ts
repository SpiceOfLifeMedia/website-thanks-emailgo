import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, queryOne, nowIso } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { parseSegmentFilters, toSegment, type SegmentRow } from '@/lib/segments';

export const runtime = 'nodejs';
function errorResponse(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const row = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments WHERE id=?', [id]);
  return row ? NextResponse.json(await toSegment(row)) : errorResponse('Segment not found.', 404);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const current = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments WHERE id=?', [id]);
  if (!current) return errorResponse('Segment not found.', 404);
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return errorResponse('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const name = body.name === undefined ? current.name : typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return errorResponse('name must be 1 to 120 single-line characters.', 400);
  let filtersJson = current.filters_json;
  if (body.filters !== undefined) {
    const filters = parseSegmentFilters(body.filters);
    if (!filters.ok) return errorResponse(filters.error, 400);
    filtersJson = JSON.stringify(filters.filters);
  }
  try { await execute('UPDATE segments SET name=?,filters_json=?,updated_at=? WHERE id=?', [name, filtersJson, nowIso(), id]); }
  catch { return errorResponse('A segment with that name already exists.', 409); }
  const updated = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments WHERE id=?', [id]);
  return updated ? NextResponse.json(await toSegment(updated)) : errorResponse('The updated segment could not be read.', 500);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const deleted = await execute('DELETE FROM segments WHERE id=?', [id]);
  return deleted ? NextResponse.json({ object: 'segment', id, deleted: true }) : errorResponse('Segment not found.', 404);
}
