import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { nowIso, execute, query, queryOne, randomId } from '@/lib/database';
import { parseCsv, stringifyCsv } from '@/lib/csv';
import { readBytesLimited } from '@/lib/request-json';
import { withApiRequestLog } from '@/lib/request-logs';
import { planContactPropertyDefinitions } from '@/lib/contact-import-properties';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const maxFileBytes = 2_000_000;
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const mappedPropertyKey = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const passthroughHeaders = ['tags', 'tags_json', 'unsubscribed', 'opted_out', 'consent_status', 'consent_source', 'consented_at'];

type ImportSummary = {
  id: string;
  object: 'contact_import';
  status: 'in_progress' | 'completed' | 'failed';
  created_at: string;
  completed_at: string | null;
  counts: { total: number; created: number; updated: number; skipped: number; failed: number };
  errors?: Array<{ row: number; message: string }>;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function parseFormJson(value: FormDataEntryValue | null, fieldName: string): { value?: unknown; error?: string } {
  if (value === null || value === '') return {};
  if (typeof value !== 'string') return { error: `${fieldName} must be JSON-encoded text.` };
  try { return { value: JSON.parse(value) as unknown }; }
  catch { return { error: `${fieldName} must contain valid JSON.` }; }
}

function headerKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseSummary(row: { id: string; status: string; counts_json: string; errors_json: string; created_at: string; completed_at: string | null }): ImportSummary {
  let counts = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  let errors: Array<{ row: number; message: string }> = [];
  try { counts = { ...counts, ...JSON.parse(row.counts_json) }; } catch {}
  try { errors = JSON.parse(row.errors_json) as Array<{ row: number; message: string }>; } catch {}
  return { id: row.id, object: 'contact_import', status: row.status as ImportSummary['status'], created_at: row.created_at, completed_at: row.completed_at, counts, ...(errors.length ? { errors } : {}) };
}

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('limit must be an integer from 1 to 100.', 400);
  const after = params.get('after');
  const before = params.get('before');
  if (after !== null && before !== null) return errorResponse('Use either after or before, not both.', 400);
  const status = params.get('status');
  if (status !== null && !['in_progress', 'completed', 'failed'].includes(status)) return errorResponse('status must be in_progress, completed or failed.', 400);
  const where = ['api_key_id=?'];
  const values: Array<string | number> = [key.id];
  if (status) { where.push('status=?'); values.push(status); }
  let reverse = false;
  const cursor = after ?? before;
  if (cursor !== null) {
    if (!cursor) return errorResponse(`${after !== null ? 'after' : 'before'} must be a non-empty import ID.`, 400);
    const row = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM contact_imports WHERE id=? AND api_key_id=?', [cursor, key.id]);
    if (!row) return errorResponse(`${after !== null ? 'after' : 'before'} must be an import ID owned by this API key.`, 400);
    where.push(after !== null ? '(created_at<? OR (created_at=? AND id<?))' : '(created_at>? OR (created_at=? AND id>?))');
    values.push(row.created_at, row.created_at, row.id);
    reverse = before !== null;
  }
  const rows = (await query<{ id: string; status: string; counts_json: string; errors_json: string; created_at: string; completed_at: string | null }>(
    `SELECT id,status,counts_json,errors_json,created_at,completed_at FROM contact_imports WHERE ${where.join(' AND ')}
      ORDER BY created_at ${reverse ? 'ASC' : 'DESC'},id ${reverse ? 'ASC' : 'DESC'} LIMIT ?`,
    [...values, limit + 1],
  )).rows;
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  if (reverse) data.reverse();
  return NextResponse.json({ object: 'list', has_more: hasMore, data: data.map(parseSummary), ...(hasMore && !reverse ? { next_after: data.at(-1)?.id } : {}), ...(hasMore && reverse ? { next_before: data[0]?.id } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_POST_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const multipartBody = await readBytesLimited(request, maxFileBytes + 200_000);
  if (!multipartBody.ok) return multipartBody.status === 413
    ? errorResponse('CSV uploads are limited to 2 MB.', 413)
    : errorResponse('Could not read the upload body.', multipartBody.status);
  let form: FormData;
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return errorResponse('Upload a valid multipart CSV form.', 400);
  const formBytes = new Uint8Array(multipartBody.bytes.byteLength);
  formBytes.set(multipartBody.bytes);
  try { form = await new Response(formBytes.buffer, { headers: { 'content-type': contentType } }).formData(); }
  catch { return errorResponse('Upload a valid multipart CSV form.', 400); }
  const fileValue = form.get('file');
  if (!fileValue || typeof fileValue === 'string' || typeof (fileValue as File).arrayBuffer !== 'function') return errorResponse('Choose a CSV file to import.', 400);
  const file = fileValue as File;
  if (file.size > maxFileBytes) return errorResponse('CSV uploads are limited to 2 MB.', 413);
  if (file.name && !file.name.toLowerCase().endsWith('.csv')) return errorResponse('Choose a file with a .csv extension.', 400);
  let csv: string;
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { return errorResponse('The CSV file must use valid UTF-8 text.', 400); }

  const parsedCsv = parseCsv(csv);
  if (!parsedCsv.ok) {
    const exceedsRowLimit = parsedCsv.error === 'CSV may contain at most 2000 contact rows.';
    return errorResponse(exceedsRowLimit ? 'CSV imports are limited to 2,000 data rows.' : parsedCsv.error, exceedsRowLimit ? 413 : 400);
  }
  if (parsedCsv.rows.length < 2) return errorResponse('CSV must include a header row and at least one contact.', 400);
  const originalHeaders = parsedCsv.rows[0].map((header) => header.trim());
  const normalizedHeaders = originalHeaders.map(headerKey);
  if (normalizedHeaders.some((header) => !header) || new Set(normalizedHeaders).size !== normalizedHeaders.length) return errorResponse('CSV headers must be non-empty and unique.', 400);

  const mapField = parseFormJson(form.get('column_map'), 'column_map');
  if (mapField.error) return errorResponse(mapField.error, 400);
  if (!mapField.value || typeof mapField.value !== 'object' || Array.isArray(mapField.value)) return errorResponse('column_map must be a JSON object.', 400);
  const columnMap = mapField.value as Record<string, unknown>;
  const allowedKeys = new Set(['email', 'first_name', 'last_name', 'properties']);
  if (Object.keys(columnMap).some((name) => !allowedKeys.has(name))) return errorResponse('column_map supports email, first_name, last_name and properties.', 400);
  const findColumn = (fieldName: string, required = false) => {
    const column = columnMap[fieldName];
    if (column === undefined && !required) return -1;
    if (typeof column !== 'string' || !column.trim()) return -2;
    const index = normalizedHeaders.indexOf(headerKey(column));
    return index < 0 ? -2 : index;
  };
  const emailColumn = findColumn('email', true);
  const firstNameColumn = findColumn('first_name');
  const lastNameColumn = findColumn('last_name');
  if (emailColumn < 0) return errorResponse('column_map.email must name a CSV column containing email addresses.', 400);
  if (firstNameColumn === -2 || lastNameColumn === -2) return errorResponse('Mapped name columns must exist in the CSV file.', 400);
  const properties = columnMap.properties === undefined ? {} : columnMap.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return errorResponse('column_map.properties must be an object.', 400);
  if (Object.keys(properties).length > 50) return errorResponse('column_map.properties may contain at most 50 custom properties.', 400);
  const propertyMaps: Array<{ key: string; column: number; type: 'string' | 'number' | 'boolean' }> = [];
  for (const [propertyKey, definition] of Object.entries(properties as Record<string, unknown>)) {
    if (!mappedPropertyKey.test(propertyKey) || !definition || typeof definition !== 'object' || Array.isArray(definition)) return errorResponse(`Invalid mapping for custom property "${propertyKey}".`, 400);
    const entry = definition as Record<string, unknown>;
    const type = entry.type ?? 'string';
    if (typeof entry.column !== 'string' || !entry.column.trim() || !['string', 'number', 'boolean'].includes(String(type))) return errorResponse(`Custom property "${propertyKey}" needs a column and string, number or boolean type.`, 400);
    const column = normalizedHeaders.indexOf(headerKey(entry.column));
    if (column < 0) return errorResponse(`Mapped column for custom property "${propertyKey}" does not exist in the CSV file.`, 400);
    propertyMaps.push({ key: propertyKey, column, type: type as 'string' | 'number' | 'boolean' });
  }
  const existingProperties = propertyMaps.length
    ? (await query<{ property_key: string; type: string }>(`SELECT property_key,type FROM contact_properties WHERE workspace_id=? AND property_key IN (${propertyMaps.map(() => '?').join(',')})`, [key.workspaceId, ...propertyMaps.map(({ key: propertyKey }) => propertyKey)])).rows
    : [];
  const propertyPlan = planContactPropertyDefinitions(propertyMaps, existingProperties);
  if (!propertyPlan.ok) return errorResponse(propertyPlan.error, 409);

  const mappedSegmentIds = parseFormJson(form.get('segments'), 'segments');
  if (mappedSegmentIds.error) return errorResponse(mappedSegmentIds.error, 400);
  const segmentsValue = mappedSegmentIds.value === undefined ? [] : mappedSegmentIds.value;
  if (!Array.isArray(segmentsValue) || segmentsValue.length > 100 || !segmentsValue.every((segment) => segment && typeof segment === 'object' && !Array.isArray(segment) && typeof (segment as { id?: unknown }).id === 'string')) return errorResponse('segments must be an array of up to 100 objects containing an id.', 400);
  const segmentIds = [...new Set((segmentsValue as Array<{ id: string }>).map(({ id }) => id))];
  if (segmentIds.length !== segmentsValue.length) return errorResponse('segments cannot contain duplicate IDs.', 400);
  if (segmentIds.length) {
    const found = (await query<{ id: string }>(`SELECT id FROM segments WHERE workspace_id=? AND id IN (${segmentIds.map(() => '?').join(',')})`, [key.workspaceId, ...segmentIds])).rows;
    if (found.length !== segmentIds.length) return errorResponse('One or more segments were not found.', 404);
  }

  const mappedTopics = parseFormJson(form.get('topics'), 'topics');
  if (mappedTopics.error) return errorResponse(mappedTopics.error, 400);
  const topicsValue = mappedTopics.value === undefined ? [] : mappedTopics.value;
  if (!Array.isArray(topicsValue) || topicsValue.length > 100 || !topicsValue.every((topic) => topic && typeof topic === 'object' && !Array.isArray(topic) && typeof (topic as { id?: unknown }).id === 'string' && ['opt_in', 'opt_out'].includes(String((topic as { subscription?: unknown }).subscription)))) return errorResponse('topics must contain up to 100 objects with an id and opt_in or opt_out subscription.', 400);
  const topics = topicsValue as Array<{ id: string; subscription: 'opt_in' | 'opt_out' }>;
  if (new Set(topics.map(({ id }) => id)).size !== topics.length) return errorResponse('topics cannot contain duplicate IDs.', 400);
  if (topics.length) {
    const found = (await query<{ id: string }>(`SELECT id FROM topics WHERE disabled_at IS NULL AND workspace_id=? AND id IN (${topics.map(() => '?').join(',')})`, [key.workspaceId, ...topics.map(({ id }) => id)])).rows;
    if (found.length !== topics.length) return errorResponse('One or more topics were not found or are archived.', 404);
  }

  const onConflict = form.get('on_conflict') ?? 'upsert';
  if (onConflict !== 'upsert' && onConflict !== 'skip') return errorResponse('on_conflict must be upsert or skip.', 400);
  if (topics.some(({ subscription }) => subscription === 'opt_in')) {
    for (const required of ['consent_status', 'consent_source', 'consented_at']) {
      if (!normalizedHeaders.includes(required)) return errorResponse('Topic opt_in imports require CSV columns for consent_status, consent_source and consented_at.', 400);
    }
    const consentStatusColumn = normalizedHeaders.indexOf('consent_status');
    const consentSourceColumn = normalizedHeaders.indexOf('consent_source');
    const consentedAtColumn = normalizedHeaders.indexOf('consented_at');
    for (const [index, row] of parsedCsv.rows.slice(1).entries()) {
      const consentStatus = (row[consentStatusColumn] ?? '').trim().toLowerCase();
      const consentSource = (row[consentSourceColumn] ?? '').trim();
      const consentedAt = new Date((row[consentedAtColumn] ?? '').trim());
      if (consentStatus !== 'opted_in' || consentSource.length < 2 || consentSource.length > 200 || /[\r\n]/.test(consentSource) || !Number.isFinite(consentedAt.getTime())) return errorResponse(`Row ${index + 2} needs explicit opt-in consent evidence before topic subscription.`, 400);
    }
  }

  const passThrough = passthroughHeaders.filter((header) => normalizedHeaders.includes(header));
  const outputHeaders = ['email', 'first_name', 'last_name', 'properties', ...passThrough];
  const normalizedRows: string[][] = [outputHeaders];
  const sourceEmails = new Set<string>();
  for (const row of parsedCsv.rows.slice(1)) {
    const email = (row[emailColumn] ?? '').trim().toLowerCase();
    if (emailPattern.test(email) && email.length <= 254) sourceEmails.add(email);
    const mappedProperties: Record<string, unknown> = {};
    for (const property of propertyMaps) {
      const raw = (row[property.column] ?? '').trim();
      if (!raw) continue;
      if (property.type === 'number') {
        const number = Number(raw);
        mappedProperties[property.key] = Number.isFinite(number) ? number : { invalid: true };
      } else if (property.type === 'boolean') {
        const value = raw.toLowerCase();
        mappedProperties[property.key] = ['true', '1', 'yes'].includes(value) ? true : ['false', '0', 'no'].includes(value) ? false : { invalid: true };
      } else mappedProperties[property.key] = raw;
    }
    const passthroughValues = passThrough.map((header) => row[normalizedHeaders.indexOf(header)] ?? '');
    normalizedRows.push([email, firstNameColumn < 0 ? '' : row[firstNameColumn] ?? '', lastNameColumn < 0 ? '' : row[lastNameColumn] ?? '', JSON.stringify(mappedProperties), ...passthroughValues]);
  }
  const normalizedCsv = stringifyCsv(normalizedRows);
  const parsedNormalized = parseCsv(normalizedCsv);
  if (!parsedNormalized.ok) return errorResponse('Could not prepare the mapped contact import.', 400);
  if (onConflict === 'upsert' && topics.some(({ subscription }) => subscription === 'opt_in') && sourceEmails.size) {
    const emails = [...sourceEmails];
    const existing = (await query<{ email: string; unsubscribed_at: string | null }>(`SELECT lower(email) AS email,unsubscribed_at FROM contacts WHERE workspace_id=? AND lower(email) IN (${emails.map(() => '?').join(',')})`, [key.workspaceId, ...emails])).rows;
    if (existing.some((contact) => contact.unsubscribed_at)) return errorResponse('A contact unsubscribed in this workspace cannot be added to a topic by import.', 409);
  }
  const total = parsedCsv.rows.length - 1;
  const startedAt = nowIso();
  const importId = randomId('imp');
  const initialCounts = { total, created: 0, updated: 0, skipped: 0, failed: 0 };
  const payload = {
    workspaceId: key.workspaceId,
    normalizedCsv,
    onConflict,
    propertyDefinitions: propertyPlan.create,
    segmentIds,
    topics,
  };
  await execute('INSERT INTO contact_imports(id,api_key_id,status,counts_json,errors_json,created_at,completed_at,payload_json,processing_started_at) VALUES(?,?,?,?,?,?,NULL,?,NULL)',
    [importId, key.id, 'in_progress', JSON.stringify(initialCounts), '[]', startedAt, JSON.stringify(payload)]);
  const summary: ImportSummary = { id: importId, object: 'contact_import', status: 'in_progress', created_at: startedAt, completed_at: null, counts: initialCounts };
  const statusUrl = new URL(`/api/v1/contacts/imports/${encodeURIComponent(importId)}`, request.url).toString();
  return NextResponse.json(summary, { status: 202, headers: { 'Cache-Control': 'private, no-store', Location: statusUrl } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
