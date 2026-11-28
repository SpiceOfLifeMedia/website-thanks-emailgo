import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { getWebhookSecret, validateWebhookEndpoint, validateWebhookEvents, webhookMasterSecret } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

export async function GET() {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const rows = await query<{ id: string; api_key_id: string; key_name: string; endpoint: string; events_json: string; created_at: string; updated_at: string; disabled_at: string | null }>(
    `SELECT w.id,w.api_key_id,k.name AS key_name,w.endpoint,w.events_json,w.created_at,w.updated_at,w.disabled_at
     FROM webhooks w JOIN api_keys k ON k.id=w.api_key_id ORDER BY w.created_at DESC,w.id DESC LIMIT 200`,
  );
  return NextResponse.json({ data: rows.rows.map((row) => ({ id: row.id, api_key_id: row.api_key_id, key_name: row.key_name, endpoint: row.endpoint, events: JSON.parse(row.events_json) as string[], created_at: row.created_at, updated_at: row.updated_at, active: !row.disabled_at })) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  if (!webhookMasterSecret()) return error('Set EMAILGO_WEBHOOK_SECRET to a random value of at least 32 characters before adding a webhook.', 503);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const apiKeyId = typeof body.api_key_id === 'string' ? body.api_key_id : '';
  const key = await queryOne<{ id: string; name: string }>('SELECT id,name FROM api_keys WHERE id=? AND revoked_at IS NULL', [apiKeyId]);
  if (!key) return error('Choose an active API key for this webhook.', 400);
  const endpoint = validateWebhookEndpoint(body.endpoint);
  const events = validateWebhookEvents(body.events);
  if (!endpoint) return error('Endpoint must be an HTTPS URL without credentials or a fragment.', 400);
  if (!events) return error('Choose at least one supported event without duplicates.', 400);
  const count = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM webhooks WHERE api_key_id=? AND disabled_at IS NULL', [apiKeyId]);
  if ((count?.count ?? 0) >= 50) return error('This API key has reached the 50 active webhook limit.', 409);
  const id = randomId('wh');
  const timestamp = nowIso();
  await execute('INSERT INTO webhooks(id,api_key_id,endpoint,events_json,secret_generation,created_at,updated_at) VALUES(?,?,?,?,1,?,?)', [id, apiKeyId, endpoint, JSON.stringify(events), timestamp, timestamp]);
  return NextResponse.json({ id, api_key_id: apiKeyId, key_name: key.name, endpoint, events, secret: getWebhookSecret(id, 1), created_at: timestamp }, { status: 201 });
}
