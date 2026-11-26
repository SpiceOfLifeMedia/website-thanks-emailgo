import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { validateWebhookEndpoint, validateWebhookEvents } from '@/lib/webhooks';

export const runtime = 'nodejs';
type HookRow = { id: string; endpoint: string; events_json: string; created_at: string; updated_at: string; disabled_at: string | null };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
function format(row: HookRow) { return { id: row.id, object: 'webhook', endpoint: row.endpoint, events: JSON.parse(row.events_json) as string[], created_at: row.created_at, updated_at: row.updated_at }; }

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const row = await queryOne<HookRow>('SELECT id,endpoint,events_json,created_at,updated_at,disabled_at FROM webhooks WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [id, apiKey.id]);
  return row ? NextResponse.json(format(row)) : error('Webhook not found.', 404);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((key) => !['endpoint', 'events'].includes(key))) return error('Update endpoint, events, or both.', 400);
  const row = await queryOne<HookRow>('SELECT id,endpoint,events_json,created_at,updated_at,disabled_at FROM webhooks WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [id, apiKey.id]);
  if (!row) return error('Webhook not found.', 404);
  const endpoint = body.endpoint === undefined ? row.endpoint : validateWebhookEndpoint(body.endpoint);
  const events = body.events === undefined ? JSON.parse(row.events_json) as string[] : validateWebhookEvents(body.events);
  if (!endpoint) return error('endpoint must be an HTTPS URL without credentials or a fragment, using the default HTTPS port.', 400);
  if (!events) return error('events contains an unsupported or duplicate event name.', 400);
  const updatedAt = nowIso();
  await execute('UPDATE webhooks SET endpoint=?,events_json=?,updated_at=? WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [endpoint, JSON.stringify(events), updatedAt, id, apiKey.id]);
  return NextResponse.json({ id, object: 'webhook', endpoint, events, created_at: row.created_at, updated_at: updatedAt });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return error('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const timestamp = nowIso();
  const removed = await execute('UPDATE webhooks SET disabled_at=?,updated_at=? WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [timestamp, timestamp, id, apiKey.id]);
  if (!removed) return error('Webhook not found.', 404);
  await execute("UPDATE webhook_deliveries SET status='cancelled',next_attempt_at=NULL,last_error='Webhook endpoint was disabled.' WHERE webhook_id=? AND status IN ('pending','failed')", [id]);
  return NextResponse.json({ id, object: 'webhook', deleted: true });
}
