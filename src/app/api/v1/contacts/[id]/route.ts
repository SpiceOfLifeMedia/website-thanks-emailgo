import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
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
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

function toContact(row: ContactRow) {
  let properties: unknown = {};
  let tags: unknown = [];
  try { properties = JSON.parse(row.properties_json); } catch {}
  try { tags = JSON.parse(row.tags_json); } catch {}
  return {
    id: row.id, object: 'contact', email: row.email, name: row.name,
    properties, tags, unsubscribed: Boolean(row.unsubscribed_at),
    consent_status: row.consent_status,
    consent_source: row.consent_source,
    consented_at: row.consented_at,
    ...(row.unsubscribed_at ? { unsubscribed_at: row.unsubscribed_at } : {}),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const contact = await queryOne<ContactRow>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE id=?', [id]);
  return contact ? NextResponse.json(toContact(contact)) : errorResponse('Contact not found.', 404);
}

async function __emailgo_PATCH_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const current = await queryOne<ContactRow>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE id=?', [id]);
  if (!current) return errorResponse('Contact not found.', 404);
  const parsed = await readJsonLimited(request, 50_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return errorResponse('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;

  const email = body.email === undefined ? current.email : typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailPattern.test(email) || email.length > 254) return errorResponse('Enter a valid contact email address.', 400);
  const name = body.name === undefined ? current.name : body.name === null ? null : typeof body.name === 'string' ? body.name.trim() : undefined;
  if (name === undefined || (name !== null && name.length > 120)) return errorResponse('name must be no more than 120 characters.', 400);

  let propertiesJson = current.properties_json;
  if (body.properties !== undefined) {
    if (!body.properties || typeof body.properties !== 'object' || Array.isArray(body.properties)) return errorResponse('properties must be an object of simple values.', 400);
    const entries = Object.entries(body.properties as Record<string, unknown>);
    if (entries.length > 50 || !entries.every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)) && (typeof value !== 'string' || value.length <= 1000))) return errorResponse('properties must contain up to 50 short string, number, boolean or null values.', 400);
    propertiesJson = JSON.stringify(Object.fromEntries(entries));
  }

  let tagsJson = current.tags_json;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 50 || !body.tags.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag))) return errorResponse('tags must be an array of up to 50 short tag names.', 400);
    tagsJson = JSON.stringify([...new Set(body.tags as string[])]);
  }
  if (body.unsubscribed !== undefined && typeof body.unsubscribed !== 'boolean') return errorResponse('unsubscribed must be a boolean.', 400);
  if (body.consent_status !== undefined && body.consent_status !== 'unknown' && body.consent_status !== 'opted_in') return errorResponse('consent_status must be unknown or opted_in.', 400);
  const consentSource = body.consent_source === undefined ? undefined : typeof body.consent_source === 'string' ? body.consent_source.trim() : '';
  if (consentSource !== undefined && (consentSource.length < 2 || consentSource.length > 200 || /[\r\n]/.test(consentSource))) return errorResponse('consent_source must be 2 to 200 single-line characters.', 400);
  if (body.consent_status === 'opted_in' && !consentSource) return errorResponse('consent_source is required when recording opt-in.', 400);
  if (body.consent_status === 'opted_in' && body.unsubscribed === true) return errorResponse('A contact cannot be opted in and unsubscribed at the same time.', 400);
  if (body.unsubscribed === false && current.unsubscribed_at && !(body.consent_status === 'opted_in' && consentSource)) return errorResponse('Resubscribing requires a new explicit opt-in and consent_source.', 400);
  const updatedAt = nowIso();
  const unsubscribedAt = body.unsubscribed === undefined ? current.unsubscribed_at : body.unsubscribed ? current.unsubscribed_at ?? updatedAt : null;
  const consentStatus = body.consent_status === undefined ? current.consent_status : body.consent_status;
  const consentSourceValue = consentStatus === 'opted_in' ? consentSource ?? current.consent_source : null;
  const consentedAt = consentStatus === 'opted_in' ? current.consent_status === 'opted_in' ? current.consented_at : updatedAt : null;
  try {
    await execute('UPDATE contacts SET email=?,name=?,properties_json=?,tags_json=?,unsubscribed_at=?,consent_status=?,consent_source=?,consented_at=?,updated_at=? WHERE id=?', [email, name, propertiesJson, tagsJson, unsubscribedAt, consentStatus, consentSourceValue, consentedAt, updatedAt, id]);
  } catch {
    return errorResponse('A contact with that email already exists.', 409);
  }
  const updated = await queryOne<ContactRow>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts WHERE id=?', [id]);
  if (updated) {
    await emitWebhookEvent(apiKey.id, 'contact.updated', { contact_id: id, email: updated.email });
    if (!current.unsubscribed_at && updated.unsubscribed_at) await emitWebhookEvent(apiKey.id, 'contact.unsubscribed', { contact_id: id, email: updated.email, unsubscribed_at: updated.unsubscribed_at });
    if (current.consent_status !== 'opted_in' && updated.consent_status === 'opted_in') await emitWebhookEvent(apiKey.id, 'contact.subscribed', { contact_id: id, email: updated.email, consent_source: updated.consent_source, consented_at: updated.consented_at });
  }
  return updated ? NextResponse.json(toContact(updated)) : errorResponse('The updated contact could not be read.', 500);
}

async function __emailgo_DELETE_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const contact = await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [id]);
  if (!contact) return errorResponse('Contact not found.', 404);
  const deleted = await execute('DELETE FROM contacts WHERE id=?', [id]);
  if (!deleted) return errorResponse('Contact not found.', 404);
  await emitWebhookEvent(apiKey.id, 'contact.deleted', { contact_id: id, email: contact.email });
  return NextResponse.json({ object: 'contact', id, deleted: true });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
