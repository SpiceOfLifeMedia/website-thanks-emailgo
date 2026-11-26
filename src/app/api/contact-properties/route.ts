import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { createContactProperty, contactPropertyResponse, listContactProperties, parseContactPropertyValue, type ContactPropertyType } from '@/lib/contact-properties';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
const keyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;

export async function GET() {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  return NextResponse.json({ data: (await listContactProperties()).map(contactPropertyResponse) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!keyPattern.test(key)) return error('key must start with a letter or underscore and contain only letters, numbers, underscores, dots or hyphens.', 400);
  if (body.type !== 'string' && body.type !== 'number') return error('type must be string or number.', 400);
  const type = body.type as ContactPropertyType;
  const fallback = parseContactPropertyValue(body.fallback_value, type, 'fallback_value');
  if (!fallback.ok) return error(fallback.error, 400);
  try {
    const row = await createContactProperty(key, type, fallback.value);
    return row ? NextResponse.json(contactPropertyResponse(row), { status: 201, headers: { 'Cache-Control': 'private, no-store' } }) : error('The contact property could not be read after creation.', 500);
  } catch {
    return error('A contact property with that key already exists.', 409);
  }
}
