import { NextResponse } from 'next/server';
import { nowIso, query, randomId, transaction } from '@/lib/database';
import { parseCsv } from '@/lib/csv';

type ExistingContact = { email: string; name: string | null; properties_json: string; tags_json: string; unsubscribed_at: string | null; consent_status: 'unknown' | 'opted_in'; consent_source: string | null; consented_at: string | null };
type ImportStatement = { sql: string; params: readonly unknown[] };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const trueValues = new Set(['true', 'yes', '1', 'unsubscribed', 'opted_out']);

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseJsonRecord(value: string | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {} as Record<string, unknown>; }
}

function parseJsonTags(value: string | undefined) {
  if (!value) return [] as string[];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch { return [] as string[]; }
}

export async function importContactsCsv(
  csv: string,
  mode: 'skip' | 'upsert' = 'skip',
  includeAppliedEmails = false,
  additionalStatements?: (appliedEmails: readonly string[]) => Promise<ImportStatement[]>,
) {
  const parsed = parseCsv(csv);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.rows.length < 2) return NextResponse.json({ error: 'CSV must include a header row and at least one contact.' }, { status: 400 });

  const headers = parsed.rows[0].map(normalizeHeader);
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) return NextResponse.json({ error: 'CSV headers must be non-empty and unique.' }, { status: 400 });
  const emailColumn = headers.findIndex((header) => ['email', 'email_address'].includes(header));
  if (emailColumn < 0) return NextResponse.json({ error: 'CSV must include an email or email_address column.' }, { status: 400 });
  const nameColumn = headers.findIndex((header) => ['name', 'full_name'].includes(header));
  const firstNameColumn = headers.indexOf('first_name');
  const lastNameColumn = headers.indexOf('last_name');
  const tagsColumn = headers.findIndex((header) => ['tags', 'tag'].includes(header));
  const unsubscribeColumn = headers.findIndex((header) => ['unsubscribed', 'opted_out'].includes(header));
  const consentStatusColumn = headers.indexOf('consent_status');
  const consentSourceColumn = headers.indexOf('consent_source');
  const consentedAtColumn = headers.indexOf('consented_at');
  const propertiesColumn = headers.indexOf('properties');
  const exportedTagsColumn = headers.indexOf('tags_json');
  const reservedColumns = new Set([emailColumn, nameColumn, firstNameColumn, lastNameColumn, tagsColumn, unsubscribeColumn, consentStatusColumn, consentSourceColumn, consentedAtColumn, propertiesColumn, exportedTagsColumn, headers.indexOf('id'), headers.indexOf('unsubscribed_at'), headers.indexOf('created_at'), headers.indexOf('updated_at')].filter((index) => index >= 0));
  const propertyColumns = headers.flatMap((header, index) => {
    if (reservedColumns.has(index)) return [];
    if (!/^[a-z_][a-z0-9_.-]{0,99}$/.test(header)) return [{ index, key: '' }];
    return [{ index, key: header }];
  });
  if (propertyColumns.some(({ key }) => !key)) return NextResponse.json({ error: 'Custom property headers must use letters, numbers, underscores, periods or hyphens and begin with a letter or underscore.' }, { status: 400 });

  const errors: Array<{ row: number; message: string }> = [];
  const records: Array<{ email: string; name: string | null; properties: Record<string, unknown>; tags: string[] | null; unsubscribed: boolean; consentStatus: 'unknown' | 'opted_in'; consentSource: string | null; consentedAt: string | null }> = [];
  let skipped = 0;
  for (const [index, values] of parsed.rows.slice(1).entries()) {
    const rowNumber = index + 2;
    if (values.length > headers.length) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Row contains more values than the header.' });
      continue;
    }
    const valueAt = (column: number) => column < 0 ? '' : (values[column] ?? '').trim();
    const email = valueAt(emailColumn).toLowerCase();
    if (!emailPattern.test(email) || email.length > 254) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Email address is invalid.' });
      continue;
    }
    const fullName = nameColumn >= 0 ? valueAt(nameColumn) : [valueAt(firstNameColumn), valueAt(lastNameColumn)].filter(Boolean).join(' ');
    if (fullName.length > 120) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Name exceeds 120 characters.' });
      continue;
    }
    const properties: Record<string, unknown> = {};
    if (propertiesColumn >= 0 && valueAt(propertiesColumn)) {
      try {
        const parsedProperties: unknown = JSON.parse(valueAt(propertiesColumn));
        if (!parsedProperties || typeof parsedProperties !== 'object' || Array.isArray(parsedProperties)) throw new Error();
        for (const [key, value] of Object.entries(parsedProperties)) {
          if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) || !(value === null || ['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'string' && value.length > 1000)) throw new Error();
          properties[key] = value;
        }
      } catch {
        skipped += 1;
        if (errors.length < 20) errors.push({ row: rowNumber, message: 'properties must be a JSON object containing simple values.' });
        continue;
      }
    }
    let propertyError = false;
    for (const { index: column, key } of propertyColumns) {
      const value = valueAt(column);
      if (!value) continue;
      if (value.length > 1000) { propertyError = true; break; }
      properties[key] = value;
    }
    if (propertyError || Object.keys(properties).length > 50) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Custom properties exceed the field or count limit.' });
      continue;
    }
    const rawTags = valueAt(tagsColumn >= 0 ? tagsColumn : exportedTagsColumn);
    let importedTags: string[] | null = null;
    if (tagsColumn >= 0 || exportedTagsColumn >= 0) {
      if (rawTags.startsWith('[')) {
        try {
          const parsedTags: unknown = JSON.parse(rawTags || '[]');
          if (!Array.isArray(parsedTags) || !parsedTags.every((tag) => typeof tag === 'string')) throw new Error();
          importedTags = [...new Set(parsedTags as string[])];
        } catch {
          skipped += 1;
          if (errors.length < 20) errors.push({ row: rowNumber, message: 'tags_json must be a JSON array of strings.' });
          continue;
        }
      } else importedTags = [...new Set(rawTags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean))];
    }
    const tags = importedTags;
    if (tags && (tags.length > 50 || !tags.every((tag) => /^[A-Za-z0-9_-]{1,50}$/.test(tag)))) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Tags must be up to 50 short names separated by commas or semicolons.' });
      continue;
    }
    const unsubscribed = unsubscribeColumn >= 0 && trueValues.has(valueAt(unsubscribeColumn).toLowerCase());
    const rawConsent = valueAt(consentStatusColumn).toLowerCase();
    if (rawConsent && !['unknown', 'opted_in', 'opted_out'].includes(rawConsent)) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'consent_status must be unknown, opted_in or opted_out.' });
      continue;
    }
    const consentStatus: 'unknown' | 'opted_in' = rawConsent === 'opted_in' ? 'opted_in' : 'unknown';
    const consentSource = valueAt(consentSourceColumn) || null;
    const rawConsentedAt = valueAt(consentedAtColumn);
    const consentedDate = rawConsentedAt ? new Date(rawConsentedAt) : null;
    if (consentStatus === 'opted_in' && (!consentSource || consentSource.length > 200 || /[\r\n]/.test(consentSource) || !consentedDate || Number.isNaN(consentedDate.getTime()))) {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'Opted-in rows require a consent_source and valid consented_at timestamp.' });
      continue;
    }
    if ((rawConsent === 'opted_out' || unsubscribed) && consentStatus === 'opted_in') {
      skipped += 1;
      if (errors.length < 20) errors.push({ row: rowNumber, message: 'A row cannot be opted in and opted out at the same time.' });
      continue;
    }
    records.push({ email, name: fullName || null, properties, tags, unsubscribed: unsubscribed || rawConsent === 'opted_out', consentStatus, consentSource, consentedAt: consentedDate?.toISOString() ?? null });
  }

  if (!records.length) return NextResponse.json({ counts: { total: parsed.rows.length - 1, created: 0, updated: 0, skipped }, errors, ...(includeAppliedEmails ? { applied_emails: [] } : {}), message: 'No valid contact rows were found.' }, { status: 200 });

  const uniqueEmails = [...new Set(records.map(({ email }) => email))];
  const existingByEmail = new Map<string, ExistingContact>();
  for (let offset = 0; offset < uniqueEmails.length; offset += 400) {
    const batch = uniqueEmails.slice(offset, offset + 400);
    const placeholders = batch.map(() => '?').join(',');
    const existing = await query<ExistingContact>(`SELECT email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at FROM contacts WHERE email IN (${placeholders})`, batch);
    for (const contact of existing.rows) existingByEmail.set(contact.email, contact);
  }

  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  const seen = new Set<string>();
  const appliedEmails: string[] = [];
  let created = 0;
  let updated = 0;
  for (const record of records) {
    if (seen.has(record.email)) { skipped += 1; continue; }
    seen.add(record.email);
    const previous = existingByEmail.get(record.email);
    if (previous && mode === 'skip') { skipped += 1; continue; }
    const properties = { ...parseJsonRecord(previous?.properties_json), ...record.properties };
    const tags = record.tags ?? parseJsonTags(previous?.tags_json);
    const name = record.name ?? previous?.name ?? null;
    const timestamp = nowIso();
    const contactId = randomId('ct');
    const unsubscribedAt = record.unsubscribed ? previous?.unsubscribed_at ?? timestamp : previous?.unsubscribed_at ?? null;
    const consentStatus = record.consentStatus === 'opted_in' ? 'opted_in' : previous?.consent_status ?? 'unknown';
    const consentSource = record.consentStatus === 'opted_in' ? record.consentSource : previous?.consent_source ?? null;
    const consentedAt = record.consentStatus === 'opted_in' ? record.consentedAt : previous?.consented_at ?? null;
    if (previous) updated += 1; else created += 1;
    statements.push({
      sql: `INSERT INTO contacts(id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(email) DO UPDATE SET name=excluded.name,properties_json=excluded.properties_json,tags_json=excluded.tags_json,
        unsubscribed_at=coalesce(contacts.unsubscribed_at,excluded.unsubscribed_at),
        consent_status=CASE WHEN excluded.consent_status='opted_in' THEN excluded.consent_status ELSE contacts.consent_status END,
        consent_source=CASE WHEN excluded.consent_status='opted_in' THEN excluded.consent_source ELSE contacts.consent_source END,
        consented_at=CASE WHEN excluded.consent_status='opted_in' THEN excluded.consented_at ELSE contacts.consented_at END,
        updated_at=excluded.updated_at`,
      params: [contactId, record.email, name, JSON.stringify(properties), JSON.stringify(tags), unsubscribedAt, record.consentStatus, record.consentSource, record.consentedAt, timestamp, timestamp],
    });
    appliedEmails.push(record.email);
    existingByEmail.set(record.email, { email: record.email, name, properties_json: JSON.stringify(properties), tags_json: JSON.stringify(tags), unsubscribed_at: unsubscribedAt, consent_status: consentStatus, consent_source: consentSource, consented_at: consentedAt });
  }
  const extraStatements = additionalStatements ? await additionalStatements(appliedEmails) : [];
  if (statements.length || extraStatements.length) await transaction([...statements, ...extraStatements]);

  return NextResponse.json({
    object: 'contact_import',
    status: 'completed',
    counts: { total: parsed.rows.length - 1, created, updated, skipped },
    errors,
    ...(includeAppliedEmails ? { applied_emails: appliedEmails } : {}),
  });
}
