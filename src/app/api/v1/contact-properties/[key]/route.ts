import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { contactPropertyResponse, deleteContactProperty, getContactProperty, parseContactPropertyValue, updateContactProperty, type ContactPropertyType } from '@/lib/contact-properties';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }
async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: error('This API key has sending-only access.', 403) };
  return { key };
}

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { key } = await context.params;
  const row = await getContactProperty(key);
  return row ? NextResponse.json(contactPropertyResponse(row), { headers: privateHeaders }) : error('Contact property not found.', 404);
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { key } = await context.params;
  const current = await getContactProperty(key);
  if (!current) return error('Contact property not found.', 404);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((field) => field !== 'type' && field !== 'fallback_value')) return error('Provide type and/or fallback_value only.', 400);
  const type = body.type === undefined ? current.type : body.type;
  if (type !== 'string' && type !== 'number') return error('type must be string or number.', 400);
  let fallbackValue: unknown = null;
  if (body.fallback_value === undefined) {
    try { fallbackValue = current.fallback_value_json === null ? null : JSON.parse(current.fallback_value_json); } catch { fallbackValue = null; }
  } else {
    fallbackValue = body.fallback_value;
  }
  const fallback = parseContactPropertyValue(fallbackValue, type as ContactPropertyType, 'fallback_value');
  if (!fallback.ok) return error(fallback.error, 400);
  const updated = await updateContactProperty(key, type as ContactPropertyType, fallback.value);
  return updated ? NextResponse.json(contactPropertyResponse(updated), { headers: privateHeaders }) : error('Contact property not found.', 404);
}

export async function DELETE(request: Request, context: { params: Promise<{ key: string }> }) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { key } = await context.params;
  if (!await deleteContactProperty(key)) return error('Contact property not found.', 404);
  return NextResponse.json({ id: key, object: 'contact_property', deleted: true, contact_values_preserved: true }, { headers: privateHeaders });
}
