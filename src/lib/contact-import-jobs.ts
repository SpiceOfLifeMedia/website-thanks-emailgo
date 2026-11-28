import { execute, nowIso, query, queryOne } from '@/lib/database';
import { parseCsv } from '@/lib/csv';
import { importContactsCsv, type AppliedContact } from '@/lib/contact-import';
import { webhookEventStatements, type WebhookEventInput } from '@/lib/webhooks';

type PropertyDefinition = { key: string; type: 'string' | 'number' };
type TopicAssignment = { id: string; subscription: 'opt_in' | 'opt_out' };
type ImportPayload = {
  workspaceId: string;
  normalizedCsv: string;
  onConflict: 'upsert' | 'skip';
  propertyDefinitions: PropertyDefinition[];
  segmentIds: string[];
  topics: TopicAssignment[];
};
type ImportJobRow = { id: string; api_key_id: string; counts_json: string; payload_json: string | null };

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

class ContactImportJobError extends Error {}

function validPayload(value: unknown): value is ImportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.workspaceId === 'string'
    && typeof payload.normalizedCsv === 'string'
    && payload.normalizedCsv.length <= 5_000_000
    && ['upsert', 'skip'].includes(String(payload.onConflict))
    && Array.isArray(payload.propertyDefinitions)
    && payload.propertyDefinitions.length <= 50
    && payload.propertyDefinitions.every((item) => item && typeof item === 'object' && typeof (item as PropertyDefinition).key === 'string' && ['string', 'number'].includes(String((item as PropertyDefinition).type)))
    && Array.isArray(payload.segmentIds)
    && payload.segmentIds.length <= 100
    && payload.segmentIds.every((id) => typeof id === 'string')
    && Array.isArray(payload.topics)
    && payload.topics.length <= 100
    && payload.topics.every((item) => item && typeof item === 'object' && typeof (item as TopicAssignment).id === 'string' && ['opt_in', 'opt_out'].includes(String((item as TopicAssignment).subscription)));
}

function importTotal(countsJson: string) {
  try {
    const value = JSON.parse(countsJson) as { total?: unknown };
    return Number.isInteger(value.total) && Number(value.total) >= 0 ? Number(value.total) : 0;
  } catch { return 0; }
}

async function failImport(job: ImportJobRow, claimedAt: string | null, message: string) {
  const total = importTotal(job.counts_json);
  const failedCounts = { total, created: 0, updated: 0, skipped: 0, failed: total };
  await execute(`UPDATE contact_imports SET status='failed',counts_json=?,errors_json=?,completed_at=?,payload_json=NULL,processing_started_at=NULL
    WHERE id=? AND status='in_progress'${claimedAt ? ' AND processing_started_at=?' : ''}`,
  [JSON.stringify(failedCounts), JSON.stringify([{ row: 0, message }]), nowIso(), job.id, ...(claimedAt ? [claimedAt] : [])]);
}

function sourceEmails(normalizedCsv: string) {
  const parsed = parseCsv(normalizedCsv);
  if (!parsed.ok || parsed.rows.length < 2 || parsed.rows.length > 2001 || parsed.rows[0][0] !== 'email') return null;
  return [...new Set(parsed.rows.slice(1)
    .map((row) => (row[0] ?? '').trim().toLowerCase())
    .filter((email) => emailPattern.test(email) && email.length <= 254))];
}

async function validateImport(job: ImportJobRow, payload: ImportPayload) {
  const key = await queryOne<{ workspace_id: string }>('SELECT workspace_id FROM api_keys WHERE id=?', [job.api_key_id]);
  if (!key || key.workspace_id !== payload.workspaceId) throw new ContactImportJobError('The import workspace is no longer available.');

  const emails = sourceEmails(payload.normalizedCsv);
  if (!emails) throw new ContactImportJobError('The queued contact import is invalid.');

  if (payload.propertyDefinitions.length) {
    const keys = payload.propertyDefinitions.map(({ key: propertyKey }) => propertyKey);
    const existing = (await query<{ property_key: string; type: string }>(
      `SELECT property_key,type FROM contact_properties WHERE workspace_id=? AND property_key IN (${keys.map(() => '?').join(',')})`,
      [payload.workspaceId, ...keys],
    )).rows;
    const expected = new Map(payload.propertyDefinitions.map(({ key: propertyKey, type }) => [propertyKey, type]));
    if (existing.some(({ property_key: propertyKey, type }) => expected.get(propertyKey) !== type)) {
      throw new ContactImportJobError('A mapped contact property changed type before the import ran.');
    }
  }

  if (payload.segmentIds.length) {
    const found = (await query<{ id: string }>(
      `SELECT id FROM segments WHERE workspace_id=? AND id IN (${payload.segmentIds.map(() => '?').join(',')})`,
      [payload.workspaceId, ...payload.segmentIds],
    )).rows;
    if (found.length !== payload.segmentIds.length) throw new ContactImportJobError('A selected segment is no longer available.');
  }

  if (payload.topics.length) {
    const topicIds = payload.topics.map(({ id }) => id);
    const found = (await query<{ id: string }>(
      `SELECT id FROM topics WHERE workspace_id=? AND disabled_at IS NULL AND id IN (${topicIds.map(() => '?').join(',')})`,
      [payload.workspaceId, ...topicIds],
    )).rows;
    if (found.length !== payload.topics.length) throw new ContactImportJobError('A selected topic is no longer available.');
  }

  if (payload.onConflict === 'upsert' && payload.topics.some(({ subscription }) => subscription === 'opt_in') && emails.length) {
    const existing = (await query<{ email: string }>(
      `SELECT lower(email) AS email FROM contacts WHERE workspace_id=? AND unsubscribed_at IS NOT NULL AND lower(email) IN (${emails.map(() => '?').join(',')})`,
      [payload.workspaceId, ...emails],
    )).rows;
    if (existing.length) throw new ContactImportJobError('A contact unsubscribed in this workspace cannot be added to a topic by import.');
  }
}

async function contactImportStatements(job: ImportJobRow, payload: ImportPayload, appliedEmails: readonly string[], contacts: readonly AppliedContact[]) {
  if (!appliedEmails.length) return [];
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  const emailPlaceholders = appliedEmails.map(() => '?').join(',');
  const timestamp = nowIso();

  for (const property of payload.propertyDefinitions) {
    statements.push({
      sql: 'INSERT INTO contact_properties(property_key,type,fallback_value_json,created_at,updated_at,workspace_id) VALUES(?,?,NULL,?,?,?) ON CONFLICT(workspace_id,property_key) DO NOTHING',
      params: [property.key, property.type, timestamp, timestamp, payload.workspaceId],
    });
  }

  if (payload.segmentIds.length) {
    const segmentPlaceholders = payload.segmentIds.map(() => '?').join(',');
    statements.push({
      sql: `DELETE FROM segment_contact_exclusions WHERE segment_id IN (${segmentPlaceholders})
        AND contact_id IN (SELECT id FROM contacts WHERE workspace_id=? AND lower(email) IN (${emailPlaceholders}))`,
      params: [...payload.segmentIds, payload.workspaceId, ...appliedEmails],
    });
    statements.push({
      sql: `INSERT INTO segment_contacts(segment_id,contact_id,created_at)
        SELECT s.id,c.id,? FROM segments s CROSS JOIN contacts c
        WHERE s.id IN (${segmentPlaceholders}) AND s.workspace_id=? AND c.workspace_id=? AND lower(c.email) IN (${emailPlaceholders})
        ON CONFLICT(segment_id,contact_id) DO NOTHING`,
      params: [timestamp, ...payload.segmentIds, payload.workspaceId, payload.workspaceId, ...appliedEmails],
    });
  }

  const activeTopicRows = payload.topics.length
    ? (await query<{ id: string }>(
      `SELECT id FROM topics WHERE workspace_id=? AND disabled_at IS NULL AND id IN (${payload.topics.map(() => '?').join(',')})`,
      [payload.workspaceId, ...payload.topics.map(({ id }) => id)],
    )).rows
    : [];
  const activeTopics = new Set(activeTopicRows.map(({ id }) => id));
  for (const subscription of ['opt_in', 'opt_out'] as const) {
    const topicIds = payload.topics.filter((topic) => topic.subscription === subscription && activeTopics.has(topic.id)).map(({ id }) => id);
    if (!topicIds.length) continue;
    const topicPlaceholders = topicIds.map(() => '?').join(',');
    const consentFilter = subscription === 'opt_in'
      ? "AND c.unsubscribed_at IS NULL AND c.consent_status='opted_in' AND c.consent_source IS NOT NULL AND c.consented_at IS NOT NULL"
      : '';
    statements.push({
      sql: subscription === 'opt_in'
        ? `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at)
          SELECT c.id,t.id,?,NULL,c.consent_source,c.consented_at FROM contacts c CROSS JOIN topics t
          WHERE c.workspace_id=? AND lower(c.email) IN (${emailPlaceholders}) AND t.workspace_id=? AND t.id IN (${topicPlaceholders}) AND t.disabled_at IS NULL ${consentFilter}
          ON CONFLICT(contact_id,topic_id) DO UPDATE SET
            subscribed_at=CASE WHEN contact_topics.unsubscribed_at IS NULL THEN contact_topics.subscribed_at ELSE excluded.subscribed_at END,
            unsubscribed_at=NULL,consent_source=excluded.consent_source,consented_at=excluded.consented_at`
        : `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at)
          SELECT c.id,t.id,NULL,?,NULL,NULL FROM contacts c CROSS JOIN topics t
          WHERE c.workspace_id=? AND lower(c.email) IN (${emailPlaceholders}) AND t.workspace_id=? AND t.id IN (${topicPlaceholders}) AND t.disabled_at IS NULL
          ON CONFLICT(contact_id,topic_id) DO UPDATE SET unsubscribed_at=excluded.unsubscribed_at`,
      params: [timestamp, payload.workspaceId, ...appliedEmails, payload.workspaceId, ...topicIds],
    });
  }

  const events: WebhookEventInput[] = [];
  for (const contact of contacts) {
    const optedInTopics = payload.topics.filter(({ id, subscription }) => subscription === 'opt_in' && activeTopics.has(id)).map(({ id }) => id);
    const optedOutTopics = payload.topics.filter(({ id, subscription }) => subscription === 'opt_out' && activeTopics.has(id)).map(({ id }) => id);
    if (optedInTopics.length && !contact.unsubscribed_at && contact.consent_status === 'opted_in' && contact.consent_source && contact.consented_at) {
      events.push({
        type: 'contact.subscribed',
        stableEventId: `contact_import:${job.id}:${contact.id}:subscribed`,
        data: { contact_id: contact.id, email: contact.email, topic_ids: optedInTopics, consent_source: contact.consent_source, consented_at: contact.consented_at },
      });
    }
    if (optedOutTopics.length) {
      events.push({
        type: 'contact.unsubscribed',
        stableEventId: `contact_import:${job.id}:${contact.id}:unsubscribed`,
        data: { contact_id: contact.id, email: contact.email, topic_ids: optedOutTopics, unsubscribed_at: timestamp },
      });
    }
  }
  if (events.length) statements.push(...await webhookEventStatements(job.api_key_id, events));
  return statements;
}

async function processImport(job: ImportJobRow, claimedAt: string) {
  try {
    const rawPayload: unknown = job.payload_json ? JSON.parse(job.payload_json) : null;
    if (!validPayload(rawPayload)) throw new Error('The queued contact import is invalid.');
    const payload = rawPayload;
    await validateImport(job, payload);

    const imported = await importContactsCsv(
      payload.normalizedCsv,
      payload.onConflict,
      false,
      (appliedEmails, contacts) => contactImportStatements(job, payload, appliedEmails, contacts),
      payload.workspaceId,
      ({ counts, errors }) => [{
        sql: `UPDATE contact_imports SET status='completed',counts_json=?,errors_json=?,completed_at=?,payload_json=NULL,processing_started_at=NULL
          WHERE id=? AND status='in_progress' AND processing_started_at=?`,
        params: [JSON.stringify(counts), JSON.stringify(errors), nowIso(), job.id, claimedAt],
      }],
    );
    if (!imported.ok) {
      await failImport(job, claimedAt, 'Contact import could not be completed.');
      return 'failed' as const;
    }
    return 'completed' as const;
  } catch (cause) {
    const message = cause instanceof ContactImportJobError ? cause.message : 'Contact import could not be completed.';
    await failImport(job, claimedAt, message);
    return 'failed' as const;
  }
}

export async function processContactImportJobs(limit = 1) {
  const now = nowIso();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const abandoned = await query<ImportJobRow>(`SELECT id,api_key_id,counts_json,payload_json FROM contact_imports
    WHERE status='in_progress' AND payload_json IS NULL ORDER BY created_at ASC,id ASC LIMIT ?`, [limit]);
  for (const job of abandoned.rows) await failImport(job, null, 'Contact import data is no longer available.');

  const due = await query<ImportJobRow>(`SELECT id,api_key_id,counts_json,payload_json FROM contact_imports
    WHERE status='in_progress' AND payload_json IS NOT NULL AND (processing_started_at IS NULL OR processing_started_at<=?)
    ORDER BY created_at ASC,id ASC LIMIT ?`, [staleBefore, limit]);
  let completed = 0;
  let failed = abandoned.rows.length;
  let deferred = 0;
  for (const job of due.rows) {
    const claimedAt = nowIso();
    const claimed = await execute(`UPDATE contact_imports SET processing_started_at=?
      WHERE id=? AND status='in_progress' AND payload_json IS NOT NULL AND (processing_started_at IS NULL OR processing_started_at<=?)`,
    [claimedAt, job.id, staleBefore]);
    if (!claimed) { deferred += 1; continue; }
    if (await processImport(job, claimedAt) === 'completed') completed += 1;
    else failed += 1;
  }
  return { checked: due.rows.length + abandoned.rows.length, completed, failed, deferred, checked_at: now };
}
