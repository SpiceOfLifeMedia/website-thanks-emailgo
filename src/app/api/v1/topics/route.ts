import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { toTopic, validateTopicBody, type TopicRow } from '@/lib/topics';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }

export async function GET(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const rows = await query<TopicRow>('SELECT id,name,slug,description,created_at,updated_at FROM topics ORDER BY updated_at DESC,id DESC');
  return NextResponse.json({ object: 'list', data: await Promise.all(rows.rows.map(toTopic)) });
}

export async function POST(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const validated = validateTopicBody(parsed.value);
  if (!validated.ok) return error(validated.error, 400);
  const id = randomId('top');
  const timestamp = nowIso();
  try { await execute('INSERT INTO topics(id,name,slug,description,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, validated.value.name, validated.value.slug, validated.value.description, timestamp, timestamp]); }
  catch { return error('A topic with that name or slug already exists.', 409); }
  return NextResponse.json(await toTopic({ id, ...validated.value, created_at: timestamp, updated_at: timestamp }), { status: 201 });
}
