import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, queryOne, nowIso } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { toTopic, validateTopicBody, type TopicRow } from '@/lib/topics';

export const runtime = 'nodejs';
function notFound() { return NextResponse.json({ error: 'Topic not found.' }, { status: 404 }); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const current = await queryOne<TopicRow>('SELECT id,name,slug,description,created_at,updated_at FROM topics WHERE id=? AND disabled_at IS NULL', [id]);
  if (!current) return notFound();
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const validated = validateTopicBody(parsed.value, current);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const updatedAt = nowIso();
  try { await execute('UPDATE topics SET name=?,slug=?,description=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [validated.value.name, validated.value.slug, validated.value.description, updatedAt, id]); }
  catch { return NextResponse.json({ error: 'A topic with that name or slug already exists.' }, { status: 409 }); }
  return NextResponse.json(await toTopic({ id, ...validated.value, created_at: current.created_at, updated_at: updatedAt }));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const timestamp = nowIso();
  const changed = await execute('UPDATE topics SET disabled_at=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [timestamp, timestamp, id]);
  return changed ? NextResponse.json({ id, archived: true }) : notFound();
}
