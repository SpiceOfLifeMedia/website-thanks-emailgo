import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { parseSegmentFilters, toSegment, type SegmentRow } from '@/lib/segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const rows = await query<SegmentRow>('SELECT id,name,filters_json,created_at,updated_at FROM segments ORDER BY updated_at DESC,id DESC');
  return NextResponse.json({ data: await Promise.all(rows.rows.map(toSegment)) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return NextResponse.json({ error: 'Name must be 1 to 120 characters on a single line.' }, { status: 400 });
  const filters = parseSegmentFilters(body.filters);
  if (!filters.ok) return NextResponse.json({ error: filters.error }, { status: 400 });
  const id = randomId('seg');
  const timestamp = nowIso();
  try { await execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at) VALUES(?,?,?,?,?)', [id, name, JSON.stringify(filters.filters), timestamp, timestamp]); }
  catch { return NextResponse.json({ error: 'A segment with that name already exists.' }, { status: 409 }); }
  return NextResponse.json(await toSegment({ id, name, filters_json: JSON.stringify(filters.filters), created_at: timestamp, updated_at: timestamp }), { status: 201 });
}
