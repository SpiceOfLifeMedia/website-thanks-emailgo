import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { createEventSchema, isValidEventName, listEventSchemas, parseEventSchema } from '@/lib/event-schemas';
import { sendAutomationEventValue } from '@/app/api/v1/events/send/route';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  return NextResponse.json({ object: 'list', has_more: false, data: await listEventSchemas(key.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_POST_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 64_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (typeof body.event === 'string') return sendAutomationEventValue(request, parsed.value);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isValidEventName(name)) return error('name must be a valid event name and cannot use the reserved system event prefix.', 400);
  const parsedSchema = parseEventSchema(body.schema);
  if (!parsedSchema.ok) return error(parsedSchema.error, 400);
  try {
    const event = await createEventSchema(key.id, name, parsedSchema.schema);
    return NextResponse.json({ object: 'event', id: event.id }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return error('An event with this name already exists for this API key.', 409);
  }
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
