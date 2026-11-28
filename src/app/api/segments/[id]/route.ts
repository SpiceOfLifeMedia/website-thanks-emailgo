import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, queryOne, nowIso } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { parseSegmentFilters, toSegment, type SegmentRow } from '@/lib/segments';
import { DEFAULT_WORKSPACE_ID } from '@/lib/workspaces';

export const runtime = 'nodejs';
function notFound() { return NextResponse.json({ error: 'Segment not found.' }, { status: 404 }); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const current = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at,workspace_id FROM segments WHERE id=? AND workspace_id=?', [id, DEFAULT_WORKSPACE_ID]);
  if (!current) return notFound();
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as Record<string, unknown>;
  const name = body.name === undefined ? current.name : typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return NextResponse.json({ error: 'Name must be 1 to 120 characters on a single line.' }, { status: 400 });
  let filtersJson = current.filters_json;
  if (body.filters !== undefined) {
    const filters = parseSegmentFilters(body.filters);
    if (!filters.ok) return NextResponse.json({ error: filters.error }, { status: 400 });
    filtersJson = JSON.stringify(filters.filters);
  }
  try { await execute('UPDATE segments SET name=?,filters_json=?,updated_at=? WHERE id=? AND workspace_id=?', [name, filtersJson, nowIso(), id, DEFAULT_WORKSPACE_ID]); }
  catch { return NextResponse.json({ error: 'A segment with that name already exists.' }, { status: 409 }); }
  const updated = await queryOne<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at,workspace_id FROM segments WHERE id=? AND workspace_id=?', [id, DEFAULT_WORKSPACE_ID]);
  return updated ? NextResponse.json(await toSegment(updated, DEFAULT_WORKSPACE_ID)) : notFound();
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const deleted = await execute('DELETE FROM segments WHERE id=? AND workspace_id=?', [id, DEFAULT_WORKSPACE_ID]);
  return deleted ? NextResponse.json({ id, deleted: true }) : notFound();
}
