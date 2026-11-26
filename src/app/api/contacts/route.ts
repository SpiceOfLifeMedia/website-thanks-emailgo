import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ContactBody = { email?: unknown; name?: unknown; properties?: unknown; tags?: unknown; consent_status?: unknown; consent_source?: unknown };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function parseProperties(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, json: '{}' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'properties must be an object of simple values.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) return { ok: false, error: 'properties may contain no more than 50 values.' };
  const properties: Record<string, string | number | boolean | null> = {};
  for (const [name, propertyValue] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || !(propertyValue === null || ['string', 'number', 'boolean'].includes(typeof propertyValue)) || (typeof propertyValue === 'string' && propertyValue.length > 1000)) {
      return { ok: false, error: `Property "${name}" must have a simple name and a short string, number, boolean or null value.` };
    }
    properties[name] = propertyValue as string | number | boolean | null;
  }
  return { ok: true, json: JSON.stringify(properties) };
}

function parseTags(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, json: '[]' };
  if (!Array.isArray(value) || value.length > 50 || !value.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag))) return { ok: false, error: 'tags must be an array of up to 50 short tag names.' };
  return { ok: true, json: JSON.stringify([...new Set(value as string[])]) };
}

function validateContact(body: ContactBody) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = body.name === undefined || body.name === null ? null : typeof body.name === 'string' ? body.name.trim() : undefined;
  if (!emailPattern.test(email) || email.length > 254) return { error: 'Enter a valid contact email address.' };
  if (name === undefined || (name !== null && name.length > 120)) return { error: 'Name must be up to 120 characters.' };
  const properties = parseProperties(body.properties);
  const tags = parseTags(body.tags);
  if (!properties.ok) return { error: properties.error };
  if (!tags.ok) return { error: tags.error };
  if (body.consent_status !== undefined && body.consent_status !== 'unknown' && body.consent_status !== 'opted_in') return { error: 'consent_status must be unknown or opted_in.' };
  const consentSource = body.consent_source === undefined ? null : typeof body.consent_source === 'string' ? body.consent_source.trim() : '';
  if (body.consent_status === 'opted_in' && (!consentSource || consentSource.length < 2 || consentSource.length > 200 || /[\r\n]/.test(consentSource))) return { error: 'A valid consent source is required to record opt-in.' };
  return { value: { email, name, propertiesJson: properties.json, tagsJson: tags.json, consentStatus: body.consent_status === 'opted_in' ? 'opted_in' as const : 'unknown' as const, consentSource } };
}

export async function GET(request: Request) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const search = new URL(request.url).searchParams.get('search')?.trim().toLowerCase();
  const result = search
    ? await query(`SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE lower(email) LIKE ? OR lower(coalesce(name,'')) LIKE ? ORDER BY updated_at DESC LIMIT 500`, [`%${search}%`, `%${search}%`])
    : await query('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts ORDER BY updated_at DESC LIMIT 500');
  return NextResponse.json({ data: result.rows.map((row) => ({
    ...row,
    properties: JSON.parse(String(row.properties_json || '{}')),
    tags: JSON.parse(String(row.tags_json || '[]')),
    properties_json: undefined,
    tags_json: undefined,
  })) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 50_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const validated = validateContact(parsed.value as ContactBody);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });
  const id = randomId('ct');
  const timestamp = nowIso();
  try {
    await execute('INSERT INTO contacts(id,email,name,properties_json,tags_json,consent_status,consent_source,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [id, validated.value.email, validated.value.name, validated.value.propertiesJson, validated.value.tagsJson, validated.value.consentStatus, validated.value.consentSource, validated.value.consentStatus === 'opted_in' ? timestamp : null, timestamp, timestamp]);
  } catch {
    return NextResponse.json({ error: 'A contact with that email already exists.' }, { status: 409 });
  }
  return NextResponse.json({ id, email: validated.value.email, name: validated.value.name, properties: JSON.parse(validated.value.propertiesJson), tags: JSON.parse(validated.value.tagsJson), unsubscribed_at: null, consent_status: validated.value.consentStatus, consent_source: validated.value.consentSource, consented_at: validated.value.consentStatus === 'opted_in' ? timestamp : null, created_at: timestamp, updated_at: timestamp }, { status: 201 });
}
