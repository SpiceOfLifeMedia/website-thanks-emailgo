import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { emitWebhookEvent } from '@/lib/webhooks';

export const runtime = 'nodejs';

type ContactRow = {
  id: string;
  email: string;
  name: string | null;
  properties_json: string;
  tags_json: string;
  unsubscribed_at: string | null;
  consent_status: 'unknown' | 'opted_in';
  consent_source: string | null;
  consented_at: string | null;
  created_at: string;
  updated_at: string;
};
type ContactBody = { email?: unknown; name?: unknown; properties?: unknown; tags?: unknown; unsubscribed?: unknown; consent_status?: unknown; consent_source?: unknown };
type ContactValidation =
  | { valid: false; error: string }
  | { valid: true; value: { email?: string; name?: string | null; propertiesJson?: string; tagsJson?: string; unsubscribed?: boolean; consentStatus?: 'unknown' | 'opted_in'; consentSource?: string } };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

function toContact(row: ContactRow) {
  return {
    id: row.id,
    object: 'contact',
    email: row.email,
    name: row.name,
    properties: parseJson(row.properties_json, {}),
    tags: parseJson(row.tags_json, []),
    unsubscribed: Boolean(row.unsubscribed_at),
    consent_status: row.consent_status,
    consent_source: row.consent_source,
    consented_at: row.consented_at,
    ...(row.unsubscribed_at ? { unsubscribed_at: row.unsubscribed_at } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function validateContact(body: ContactBody, requireEmail: boolean): ContactValidation {
  const email = body.email === undefined && !requireEmail ? undefined : typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === '' || (email !== undefined && (!emailPattern.test(email) || email.length > 254))) return { valid: false, error: 'Enter a valid contact email address.' };
  const name = body.name === undefined ? undefined : body.name === null ? null : typeof body.name === 'string' ? body.name.trim() : null;
  if (name !== undefined && name !== null && name.length > 120) return { valid: false, error: 'name must be no more than 120 characters.' };

  let propertiesJson: string | undefined;
  if (body.properties !== undefined) {
    if (!body.properties || typeof body.properties !== 'object' || Array.isArray(body.properties)) return { valid: false, error: 'properties must be an object of simple values.' };
    const properties = Object.entries(body.properties as Record<string, unknown>);
    if (properties.length > 50 || !properties.every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)) && (typeof value !== 'string' || value.length <= 1000))) return { valid: false, error: 'properties must contain up to 50 short string, number, boolean or null values.' };
    propertiesJson = JSON.stringify(Object.fromEntries(properties));
  }

  let tagsJson: string | undefined;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 50 || !body.tags.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag))) return { valid: false, error: 'tags must be an array of up to 50 short tag names.' };
    tagsJson = JSON.stringify([...new Set(body.tags as string[])]);
  }
  if (body.unsubscribed !== undefined && typeof body.unsubscribed !== 'boolean') return { valid: false, error: 'unsubscribed must be a boolean.' };
  if (body.consent_status !== undefined && body.consent_status !== 'unknown' && body.consent_status !== 'opted_in') return { valid: false, error: 'consent_status must be unknown or opted_in.' };
  const consentSource = body.consent_source === undefined ? undefined : typeof body.consent_source === 'string' ? body.consent_source.trim() : '';
  if (consentSource !== undefined && (consentSource.length < 2 || consentSource.length > 200 || /[\r\n]/.test(consentSource))) return { valid: false, error: 'consent_source must be 2 to 200 single-line characters.' };
  if (body.consent_status === 'opted_in' && !consentSource) return { valid: false, error: 'consent_source is required when recording opt-in.' };
  if (body.consent_status === 'opted_in' && body.unsubscribed === true) return { valid: false, error: 'A contact cannot be opted in and unsubscribed at the same time.' };
  return { valid: true, value: { email, name, propertiesJson, tagsJson, unsubscribed: body.unsubscribed as boolean | undefined, consentStatus: body.consent_status as 'unknown' | 'opted_in' | undefined, consentSource } };
}

async function __emailgo_GET_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  const workspaceId = apiKey.workspaceId;
  let rows: ContactRow[];
  if (after !== null) {
    if (!after) return errorResponse('after must be a non-empty contact ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM contacts WHERE id=? AND workspace_id=?', [after, workspaceId]);
    if (!cursor) return errorResponse('after must be an existing contact ID.', 400);
    rows = (await query<ContactRow>(`SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts
      WHERE workspace_id=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [workspaceId, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<ContactRow>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT ?', [workspaceId, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(toContact), has_more: hasMore, ...(hasMore ? { next_after: data[data.length - 1]?.id } : {}) });
}

async function __emailgo_POST_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 50_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return errorResponse('Request body must be a JSON object.', 400);
  const validated = validateContact(parsed.value as ContactBody, true);
  if (!validated.valid) return errorResponse(validated.error, 400);
  const timestamp = nowIso();
  const id = randomId('ct');
  try {
    await execute('INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [
      id,
      validated.value.email!,
      validated.value.name ?? null,
      validated.value.propertiesJson ?? '{}',
      validated.value.tagsJson ?? '[]',
      validated.value.unsubscribed ? timestamp : null,
      validated.value.consentStatus ?? 'unknown',
      validated.value.consentStatus === 'opted_in' ? validated.value.consentSource! : null,
      validated.value.consentStatus === 'opted_in' ? timestamp : null,
      timestamp,
      timestamp,
      apiKey.workspaceId,
    ]);
  } catch {
    return errorResponse('A contact with that email already exists.', 409);
  }
  const contact = await queryOne<ContactRow>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE id=? AND workspace_id=?', [id, apiKey.workspaceId]);
  if (!contact) return errorResponse('The contact was created but could not be read.', 500);
  await emitWebhookEvent(apiKey.id, 'contact.created', { contact_id: id, email: contact.email });
  if (contact.unsubscribed_at) await emitWebhookEvent(apiKey.id, 'contact.unsubscribed', { contact_id: id, email: contact.email, unsubscribed_at: contact.unsubscribed_at });
  if (contact.consent_status === 'opted_in') await emitWebhookEvent(apiKey.id, 'contact.subscribed', { contact_id: id, email: contact.email, consent_source: contact.consent_source, consented_at: contact.consented_at });
  return NextResponse.json(toContact(contact), { status: 201 });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
