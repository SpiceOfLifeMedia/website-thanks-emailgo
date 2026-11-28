import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { getWebhookSecret, validateWebhookEndpoint, validateWebhookEvents, webhookMasterSecret, WEBHOOK_EVENT_TYPES } from '@/lib/webhooks';

export const runtime = 'nodejs';

type HookRow = { id: string; endpoint: string; events_json: string; secret_generation: number; created_at: string; updated_at: string };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
function format(row: HookRow) { return { id: row.id, object: 'webhook', endpoint: row.endpoint, events: JSON.parse(row.events_json) as string[], created_at: row.created_at, updated_at: row.updated_at }; }

async function __emailgo_GET_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let rows: HookRow[];
  if (after !== null) {
    if (!after) return error('after must be a non-empty webhook ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM webhooks WHERE id=? AND api_key_id=?', [after, apiKey.id]);
    if (!cursor) return error('after must be a webhook ID owned by this API key.', 400);
    rows = (await query<HookRow>(`SELECT id,endpoint,events_json,secret_generation,created_at,updated_at FROM webhooks
      WHERE api_key_id=? AND disabled_at IS NULL AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [apiKey.id, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<HookRow>('SELECT id,endpoint,events_json,secret_generation,created_at,updated_at FROM webhooks WHERE api_key_id=? AND disabled_at IS NULL ORDER BY created_at DESC,id DESC LIMIT ?', [apiKey.id, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(format), has_more: hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) });
}

async function __emailgo_POST_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  if (!webhookMasterSecret()) return error('Webhook signing is not configured. Set EMAILGO_WEBHOOK_SECRET to a random value of at least 32 characters.', 503);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const endpoint = validateWebhookEndpoint(body.endpoint);
  const events = validateWebhookEvents(body.events);
  if (!endpoint) return error('endpoint must be an HTTPS URL without credentials or a fragment, using the default HTTPS port.', 400);
  if (!events) return error(`events must contain unique supported event names: ${WEBHOOK_EVENT_TYPES.join(', ')}.`, 400);
  const count = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM webhooks WHERE api_key_id=? AND disabled_at IS NULL', [apiKey.id]);
  if ((count?.count ?? 0) >= 50) return error('This API key has reached the 50 active webhook limit.', 409);
  const id = randomId('wh');
  const timestamp = nowIso();
  await execute('INSERT INTO webhooks(id,api_key_id,endpoint,events_json,secret_generation,created_at,updated_at) VALUES(?,?,?,?,1,?,?)', [id, apiKey.id, endpoint, JSON.stringify(events), timestamp, timestamp]);
  return NextResponse.json({ id, object: 'webhook', endpoint, events, secret: getWebhookSecret(id, 1), created_at: timestamp, updated_at: timestamp }, { status: 201 });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
