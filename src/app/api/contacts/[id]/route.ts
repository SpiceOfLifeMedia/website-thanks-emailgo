import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';

type Contact = { id: string; email: string; name: string | null; properties_json: string; tags_json: string; unsubscribed_at: string | null; created_at: string; updated_at: string };
type ContactBody = { email?: unknown; name?: unknown; properties?: unknown; tags?: unknown };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function parseProperties(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'properties must be an object of simple values.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) return { ok: false, error: 'properties may contain no more than 50 values.' };
  const properties: Record<string, string | number | boolean | null> = {};
  for (const [name, propertyValue] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || !(propertyValue === null || ['string', 'number', 'boolean'].includes(typeof propertyValue)) || (typeof propertyValue === 'string' && propertyValue.length > 1000)) return { ok: false, error: `Property "${name}" must have a simple name and a short string, number, boolean or null value.` };
    properties[name] = propertyValue as string | number | boolean | null;
  }
  return { ok: true, json: JSON.stringify(properties) };
}

function parseTags(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 50 || !value.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag))) return { ok: false, error: 'tags must be an array of up to 50 short tag names.' };
  return { ok: true, json: JSON.stringify([...new Set(value as string[])]) };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const contact = await queryOne<Contact>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at FROM contacts WHERE id=?', [id]);
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  return NextResponse.json({ ...contact, properties: JSON.parse(contact.properties_json), tags: JSON.parse(contact.tags_json), properties_json: undefined, tags_json: undefined });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const current = await queryOne<Contact>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,created_at,updated_at FROM contacts WHERE id=?', [id]);
  if (!current) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  const parsed = await readJsonLimited(request, 50_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as ContactBody;
  const email = body.email === undefined ? current.email : typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = body.name === undefined ? current.name : body.name === null ? null : typeof body.name === 'string' ? body.name.trim() : undefined;
  if (!emailPattern.test(email) || email.length > 254) return NextResponse.json({ error: 'Enter a valid contact email address.' }, { status: 400 });
  if (name === undefined || (name !== null && name.length > 120)) return NextResponse.json({ error: 'Name must be up to 120 characters.' }, { status: 400 });
  let propertiesJson = current.properties_json;
  if (body.properties !== undefined) {
    const properties = parseProperties(body.properties);
    if (!properties.ok) return NextResponse.json({ error: properties.error }, { status: 400 });
    propertiesJson = properties.json;
  }
  let tagsJson = current.tags_json;
  if (body.tags !== undefined) {
    const tags = parseTags(body.tags);
    if (!tags.ok) return NextResponse.json({ error: tags.error }, { status: 400 });
    tagsJson = tags.json;
  }
  const updatedAt = nowIso();
  try {
    await execute('UPDATE contacts SET email=?,name=?,properties_json=?,tags_json=?,updated_at=? WHERE id=?', [email, name, propertiesJson, tagsJson, updatedAt, id]);
  } catch {
    return NextResponse.json({ error: 'A contact with that email already exists.' }, { status: 409 });
  }
  return NextResponse.json({ id, email, name, properties: JSON.parse(propertiesJson), tags: JSON.parse(tagsJson), unsubscribed_at: current.unsubscribed_at, created_at: current.created_at, updated_at: updatedAt });
}
