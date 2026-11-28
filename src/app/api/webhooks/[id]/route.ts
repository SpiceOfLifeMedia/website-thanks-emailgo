import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { validateWebhookEndpoint, validateWebhookEvents } from '@/lib/webhooks';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((key) => !['endpoint', 'events'].includes(key))) return error('Update endpoint, events, or both.', 400);
  const row = await queryOne<{ id: string; endpoint: string; events_json: string; created_at: string; api_key_id: string }>('SELECT id,endpoint,events_json,created_at,api_key_id FROM webhooks WHERE id=? AND disabled_at IS NULL', [id]);
  if (!row) return error('Webhook not found.', 404);
  const endpoint = body.endpoint === undefined ? row.endpoint : validateWebhookEndpoint(body.endpoint);
  const events = body.events === undefined ? JSON.parse(row.events_json) as string[] : validateWebhookEvents(body.events);
  if (!endpoint) return error('Endpoint must be an HTTPS URL without credentials or a fragment.', 400);
  if (!events) return error('Choose supported webhook events without duplicates.', 400);
  const updatedAt = nowIso();
  await execute('UPDATE webhooks SET endpoint=?,events_json=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [endpoint, JSON.stringify(events), updatedAt, id]);
  return NextResponse.json({ id, api_key_id: row.api_key_id, endpoint, events, created_at: row.created_at, updated_at: updatedAt });
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const timestamp = nowIso();
  const changed = await execute('UPDATE webhooks SET disabled_at=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [timestamp, timestamp, id]);
  if (!changed) return error('Webhook not found.', 404);
  await execute("UPDATE webhook_deliveries SET status='cancelled',next_attempt_at=NULL,last_error='Webhook endpoint was disabled.' WHERE webhook_id=? AND status IN ('pending','failed')", [id]);
  return NextResponse.json({ id, deleted: true });
}
