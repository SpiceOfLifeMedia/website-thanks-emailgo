import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { importContactsCsv } from '@/lib/contact-import';
import { nowIso, execute, query, queryOne, randomId } from '@/lib/database';
import { parseCsv, stringifyCsv } from '@/lib/csv';
import { readBytesLimited } from '@/lib/request-json';
import { emitWebhookEvent } from '@/lib/webhooks';
import { withApiRequestLog } from '@/lib/request-logs';

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
  if (!parsedCsv.ok) return errorResponse(parsedCsv.error, 400);
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

  const mappedSegmentIds = parseFormJson(form.get('segments'), 'segments');
  if (mappedSegmentIds.error) return errorResponse(mappedSegmentIds.error, 400);
  const segmentsValue = mappedSegmentIds.value === undefined ? [] : mappedSegmentIds.value;
  if (!Array.isArray(segmentsValue) || segmentsValue.length > 100 || !segmentsValue.every((segment) => segment && typeof segment === 'object' && !Array.isArray(segment) && typeof (segment as { id?: unknown }).id === 'string')) return errorResponse('segments must be an array of up to 100 objects containing an id.', 400);
  const segmentIds = [...new Set((segmentsValue as Array<{ id: string }>).map(({ id }) => id))];
  if (segmentIds.length !== segmentsValue.length) return errorResponse('segments cannot contain duplicate IDs.', 400);
  if (segmentIds.length) {
    const found = (await query<{ id: string }>(`SELECT id FROM segments WHERE id IN (${segmentIds.map(() => '?').join(',')})`, segmentIds)).rows;
    if (found.length !== segmentIds.length) return errorResponse('One or more segments were not found.', 404);
  }

  const mappedTopics = parseFormJson(form.get('topics'), 'topics');
  if (mappedTopics.error) return errorResponse(mappedTopics.error, 400);
  const topicsValue = mappedTopics.value === undefined ? [] : mappedTopics.value;
  if (!Array.isArray(topicsValue) || topicsValue.length > 100 || !topicsValue.every((topic) => topic && typeof topic === 'object' && !Array.isArray(topic) && typeof (topic as { id?: unknown }).id === 'string' && ['opt_in', 'opt_out'].includes(String((topic as { subscription?: unknown }).subscription)))) return errorResponse('topics must contain up to 100 objects with an id and opt_in or opt_out subscription.', 400);
  const topics = topicsValue as Array<{ id: string; subscription: 'opt_in' | 'opt_out' }>;
  if (new Set(topics.map(({ id }) => id)).size !== topics.length) return errorResponse('topics cannot contain duplicate IDs.', 400);
  if (topics.length) {
    const found = (await query<{ id: string }>(`SELECT id FROM topics WHERE disabled_at IS NULL AND id IN (${topics.map(() => '?').join(',')})`, topics.map(({ id }) => id))).rows;
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
    const existing = (await query<{ email: string; unsubscribed_at: string | null }>(`SELECT lower(email) AS email,unsubscribed_at FROM contacts WHERE lower(email) IN (${emails.map(() => '?').join(',')})`, emails)).rows;
    if (existing.some((contact) => contact.unsubscribed_at)) return errorResponse('A globally unsubscribed contact cannot be added to a topic by import.', 409);
  }
  const total = parsedCsv.rows.length - 1;
  const startedAt = nowIso();
  const importId = randomId('imp');
  const initialCounts = { total, created: 0, updated: 0, skipped: 0, failed: 0 };
  await execute('INSERT INTO contact_imports(id,api_key_id,status,counts_json,errors_json,created_at,completed_at) VALUES(?,?,?,?,?,?,NULL)', [importId, key.id, 'in_progress', JSON.stringify(initialCounts), '[]', startedAt]);

  try {
    const imported = await importContactsCsv(normalizedCsv, onConflict, true, async (appliedEmails) => {
      if (!appliedEmails.length) return [];
      const emailPlaceholders = appliedEmails.map(() => '?').join(',');
      const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
      const timestamp = nowIso();
      if (segmentIds.length) {
        const segmentPlaceholders = segmentIds.map(() => '?').join(',');
        statements.push({
          sql: `DELETE FROM segment_contact_exclusions WHERE segment_id IN (${segmentPlaceholders})
            AND contact_id IN (SELECT id FROM contacts WHERE lower(email) IN (${emailPlaceholders}))`,
          params: [...segmentIds, ...appliedEmails],
        });
        statements.push({
          sql: `INSERT INTO segment_contacts(segment_id,contact_id,created_at)
            SELECT s.id,c.id,? FROM segments s CROSS JOIN contacts c
            WHERE s.id IN (${segmentPlaceholders}) AND lower(c.email) IN (${emailPlaceholders})
            ON CONFLICT(segment_id,contact_id) DO NOTHING`,
          params: [timestamp, ...segmentIds, ...appliedEmails],
        });
      }
      for (const subscription of ['opt_in', 'opt_out'] as const) {
        const topicIds = topics.filter((topic) => topic.subscription === subscription).map((topic) => topic.id);
        if (!topicIds.length) continue;
        const topicPlaceholders = topicIds.map(() => '?').join(',');
        const consentFilter = subscription === 'opt_in'
          ? "AND c.unsubscribed_at IS NULL AND c.consent_status='opted_in' AND c.consent_source IS NOT NULL AND c.consented_at IS NOT NULL"
          : '';
        statements.push({
          sql: subscription === 'opt_in'
            ? `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at)
              SELECT c.id,t.id,?,NULL,c.consent_source,c.consented_at FROM contacts c CROSS JOIN topics t
              WHERE lower(c.email) IN (${emailPlaceholders}) AND t.id IN (${topicPlaceholders}) AND t.disabled_at IS NULL ${consentFilter}
              ON CONFLICT(contact_id,topic_id) DO UPDATE SET
                subscribed_at=CASE WHEN contact_topics.unsubscribed_at IS NULL THEN contact_topics.subscribed_at ELSE excluded.subscribed_at END,
                unsubscribed_at=NULL,consent_source=excluded.consent_source,consented_at=excluded.consented_at`
            : `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at)
              SELECT c.id,t.id,NULL,?,NULL,NULL FROM contacts c CROSS JOIN topics t
              WHERE lower(c.email) IN (${emailPlaceholders}) AND t.id IN (${topicPlaceholders}) AND t.disabled_at IS NULL
              ON CONFLICT(contact_id,topic_id) DO UPDATE SET unsubscribed_at=excluded.unsubscribed_at`,
          params: [timestamp, ...appliedEmails, ...topicIds],
        });
      }
      return statements;
    });
    const importBody = await imported.json() as { counts?: { total?: number; created?: number; updated?: number; skipped?: number }; errors?: Array<{ row: number; message: string }>; applied_emails?: string[]; error?: string | { message?: string } };
    if (!imported.ok) {
      const message = typeof importBody.error === 'string' ? importBody.error : importBody.error?.message ?? 'Contact import failed.';
      const failedCounts = { ...initialCounts, failed: total };
      await execute("UPDATE contact_imports SET status='failed',counts_json=?,errors_json=?,completed_at=? WHERE id=? AND api_key_id=?", [JSON.stringify(failedCounts), JSON.stringify([{ row: 0, message }]), nowIso(), importId, key.id]);
      return errorResponse(message, imported.status);
    }
    const counts = { total, created: Number(importBody.counts?.created ?? 0), updated: Number(importBody.counts?.updated ?? 0), skipped: Number(importBody.counts?.skipped ?? 0), failed: 0 };
    const errors = Array.isArray(importBody.errors) ? importBody.errors.slice(0, 20) : [];
    const appliedEmails = Array.isArray(importBody.applied_emails) ? [...new Set(importBody.applied_emails.filter((email): email is string => typeof email === 'string'))] : [];
    const webhookErrors: Array<{ row: number; message: string }> = [];
    if (appliedEmails.length && topics.length) {
      const placeholders = appliedEmails.map(() => '?').join(',');
      const contacts = (await query<{ id: string; email: string; unsubscribed_at: string | null; consent_status: string; consent_source: string | null; consented_at: string | null }>(`SELECT id,email,unsubscribed_at,consent_status,consent_source,consented_at FROM contacts WHERE lower(email) IN (${placeholders})`, appliedEmails)).rows;
      const topicIds = [...new Set(topics.map(({ id }) => id))];
      const activeTopics = new Set((await query<{ id: string }>(`SELECT id FROM topics WHERE disabled_at IS NULL AND id IN (${topicIds.map(() => '?').join(',')})`, topicIds)).rows.map(({ id }) => id));
      const timestamp = nowIso();
      for (const contact of contacts) {
        const optedInTopics = topics.filter(({ id, subscription }) => subscription === 'opt_in' && activeTopics.has(id)).map(({ id }) => id);
        const optedOutTopics = topics.filter(({ id, subscription }) => subscription === 'opt_out' && activeTopics.has(id)).map(({ id }) => id);
        try {
          if (optedInTopics.length && !contact.unsubscribed_at && contact.consent_status === 'opted_in' && contact.consent_source && contact.consented_at) {
            await emitWebhookEvent(key.id, 'contact.subscribed', { contact_id: contact.id, email: contact.email, topic_ids: optedInTopics, consent_source: contact.consent_source, consented_at: contact.consented_at });
          }
          if (optedOutTopics.length) await emitWebhookEvent(key.id, 'contact.unsubscribed', { contact_id: contact.id, email: contact.email, topic_ids: optedOutTopics, unsubscribed_at: timestamp });
        } catch {
          webhookErrors.push({ row: 0, message: 'A contact subscription webhook could not be queued.' });
        }
      }
    }
    errors.push(...webhookErrors.slice(0, Math.max(0, 20 - errors.length)));
    const completedAt = nowIso();
    await execute("UPDATE contact_imports SET status='completed',counts_json=?,errors_json=?,completed_at=? WHERE id=? AND api_key_id=?", [JSON.stringify(counts), JSON.stringify(errors), completedAt, importId, key.id]);
    const summary: ImportSummary = { id: importId, object: 'contact_import', status: 'completed', created_at: startedAt, completed_at: completedAt, counts, ...(errors.length ? { errors } : {}) };
    return NextResponse.json(summary, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (cause) {
    const message = 'Contact import could not be completed.';
    const failedCounts = { ...initialCounts, failed: total };
    await execute("UPDATE contact_imports SET status='failed',counts_json=?,errors_json=?,completed_at=? WHERE id=? AND api_key_id=?", [JSON.stringify(failedCounts), JSON.stringify([{ row: 0, message }]), nowIso(), importId, key.id]);
    return errorResponse(message, 500);
  }
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
