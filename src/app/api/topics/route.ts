import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { toTopic, validateTopicBody, type TopicRow } from '@/lib/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const rows = await query<TopicRow>('SELECT id,name,slug,description,created_at,updated_at FROM topics WHERE disabled_at IS NULL ORDER BY updated_at DESC,id DESC');
  return NextResponse.json({ data: await Promise.all(rows.rows.map(toTopic)) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const validated = validateTopicBody(parsed.value);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const id = randomId('top');
  const timestamp = nowIso();
  try { await execute('INSERT INTO topics(id,name,slug,description,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, validated.value.name, validated.value.slug, validated.value.description, timestamp, timestamp]); }
  catch { return NextResponse.json({ error: 'A topic with that name or slug already exists.' }, { status: 409 }); }
  return NextResponse.json(await toTopic({ id, ...validated.value, created_at: timestamp, updated_at: timestamp }), { status: 201 });
}
