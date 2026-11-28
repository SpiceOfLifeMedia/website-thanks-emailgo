import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { deleteEventSchema, findEventSchema, parseEventSchema, updateEventSchema } from '@/lib/event-schemas';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
async function authorized(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { response: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { response: error('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorized(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const event = await findEventSchema(auth.key.id, id);
  if (!event) return error('Event not found.', 404);
  return NextResponse.json({ object: 'event', ...event }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_PATCH_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorized(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 64_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value) || !Object.hasOwn(parsed.value as object, 'schema')) return error('schema is required and must be an object or null.', 400);
  const parsedSchema = parseEventSchema((parsed.value as Record<string, unknown>).schema);
  if (!parsedSchema.ok) return error(parsedSchema.error, 400);
  const event = await updateEventSchema(auth.key.id, id, parsedSchema.schema);
  if (!event) return error('Event not found.', 404);
  return NextResponse.json({ object: 'event', id: event.id }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_DELETE_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorized(request);
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const event = await deleteEventSchema(auth.key.id, id);
  if (!event) return error('Event not found.', 404);
  return NextResponse.json({ object: 'event', id: event.id, deleted: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
