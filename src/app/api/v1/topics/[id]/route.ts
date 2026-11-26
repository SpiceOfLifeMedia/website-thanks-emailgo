import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, queryOne, nowIso } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { toTopic, validateTopicBody, type TopicRow } from '@/lib/topics';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const row = await queryOne<TopicRow>('SELECT id,name,slug,description,created_at,updated_at FROM topics WHERE id=? AND disabled_at IS NULL', [id]);
  return row ? NextResponse.json(await toTopic(row)) : error('Topic not found.', 404);
}

async function __emailgo_PATCH_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const current = await queryOne<TopicRow>('SELECT id,name,slug,description,created_at,updated_at FROM topics WHERE id=? AND disabled_at IS NULL', [id]);
  if (!current) return error('Topic not found.', 404);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const validated = validateTopicBody(parsed.value, current);
  if (!validated.ok) return error(validated.error, 400);
  const updatedAt = nowIso();
  try { await execute('UPDATE topics SET name=?,slug=?,description=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [validated.value.name, validated.value.slug, validated.value.description, updatedAt, id]); }
  catch { return error('A topic with that name or slug already exists.', 409); }
  return NextResponse.json(await toTopic({ id, ...validated.value, created_at: current.created_at, updated_at: updatedAt }));
}

async function __emailgo_DELETE_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const disabledAt = nowIso();
  const changed = await execute('UPDATE topics SET disabled_at=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [disabledAt, disabledAt, id]);
  return changed ? NextResponse.json({ object: 'topic', id, archived: true }) : error('Topic not found.', 404);
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
