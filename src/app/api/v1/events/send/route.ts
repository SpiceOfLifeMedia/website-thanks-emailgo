import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { emitAutomationEvent } from '@/lib/automations';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { findEventSchema, validateEventPayload } from '@/lib/event-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const eventPattern = /^(?!resend:)[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/;
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

export async function sendAutomationEventValue(request: Request, requestBody: unknown) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) return error('Request body must be an object.', 400);
  const body = requestBody as Record<string, unknown>;
  const event = typeof body.event === 'string' ? body.event : '';
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
  if (!eventPattern.test(event)) return error('event must be a valid name such as account.created.', 400);
  if (Boolean(contactId) === Boolean(email)) return error('Provide exactly one of contact_id or email.', 400);
  if (email && !emailPattern.test(email)) return error('email must be a valid email address.', 400);
  if (contactId && contactId.length > 120) return error('contact_id is too long.', 400);
  let payload = body.payload === undefined ? {} : body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return error('payload must be an object.', 400);
  const eventDefinition = await findEventSchema(key.id, event);
  if (eventDefinition?.schema) {
    const validation = validateEventPayload(payload as Record<string, unknown>, eventDefinition.schema);
    if (!validation.ok) return error(validation.error, 400);
    payload = validation.payload;
  }
  const contact = contactId
    ? await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [contactId])
    : await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE lower(email)=lower(?)', [email]);
  if (contactId && !contact) return error('Contact not found.', 404);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) return error('Idempotency-Key must contain 1 to 200 single-line characters.', 400);
  try {
    const result = await emitAutomationEvent({ apiKeyId: key.id, event, payload: payload as Record<string, unknown>, contactId: contact?.id ?? null, email: contact?.email ?? email, idempotencyKey });
    if (result.conflict) return error('This Idempotency-Key was already used with a different event.', 409);
    const isResendPath = new URL(request.url).pathname.endsWith('/events/send');
    return NextResponse.json(isResendPath
      ? { object: 'event', event }
      : { id: result.eventId, object: 'event', event, run_ids: result.runIds, duplicate: result.duplicate },
    { status: isResendPath ? 200 : result.duplicate ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return error('Could not record automation event.', 500); }
}

export async function sendAutomationEvent(request: Request) {
  const parsed = await readJsonLimited(request, 64_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  return sendAutomationEventValue(request, parsed.value);
}

export const POST = withApiRequestLog(sendAutomationEvent);
