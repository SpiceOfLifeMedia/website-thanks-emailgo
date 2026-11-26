import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { createContactProperty, contactPropertyResponse, listContactProperties, parseContactPropertyValue, type ContactPropertyType } from '@/lib/contact-properties';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: error('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const rows = await listContactProperties();
  return NextResponse.json({ object: 'list', data: rows.map(contactPropertyResponse), has_more: false }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_POST_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key)) return error('key must start with a letter or underscore and contain only letters, numbers, underscores, dots or hyphens.', 400);
  if (body.type !== 'string' && body.type !== 'number') return error('type must be string or number.', 400);
  const type = body.type as ContactPropertyType;
  const fallback = parseContactPropertyValue(body.fallback_value, type, 'fallback_value');
  if (!fallback.ok) return error(fallback.error, 400);
  try {
    const row = await createContactProperty(key, type, fallback.value);
    return row ? NextResponse.json(contactPropertyResponse(row), { status: 201 }) : error('The contact property could not be read after creation.', 500);
  } catch {
    return error('A contact property with that key already exists.', 409);
  }
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
