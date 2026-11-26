import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { emitAutomationEvent } from '@/lib/automations';
import { query, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const eventPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/;
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function GET(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const rows = await query<{ event_name: string; last_seen_at: string; count: number }>('SELECT event_name,MAX(created_at) AS last_seen_at,COUNT(*) AS count FROM automation_events WHERE api_key_id=? GROUP BY event_name ORDER BY last_seen_at DESC LIMIT 100', [key.id]);
  return NextResponse.json({ object: 'list', data: rows.rows }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 64_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const event = typeof body.event === 'string' ? body.event : '';
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  if (!eventPattern.test(event)) return error('event must be a valid name such as account.created.', 400);
  if (Boolean(contactId) === Boolean(email)) return error('Provide exactly one of contact_id or email.', 400);
  if (email && !emailPattern.test(email)) return error('email must be a valid email address.', 400);
  if (contactId && contactId.length > 120) return error('contact_id is too long.', 400);
  const payload = body.payload === undefined ? {} : body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return error('payload must be an object.', 400);
  const contact = contactId
    ? await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [contactId])
    : await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE lower(email)=lower(?)', [email]);
  if (contactId && !contact) return error('Contact not found.', 404);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) return error('Idempotency-Key must contain 1 to 200 single-line characters.', 400);
  try {
    const result = await emitAutomationEvent({ apiKeyId: key.id, event, payload: payload as Record<string, unknown>, contactId: contact?.id ?? null, email: contact?.email ?? email, idempotencyKey });
    if (result.conflict) return error('This Idempotency-Key was already used with a different event.', 409);
    return NextResponse.json({ id: result.eventId, object: 'event', event, run_ids: result.runIds, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return error('Could not record automation event.', 500); }
}
