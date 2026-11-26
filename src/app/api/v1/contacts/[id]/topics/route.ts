import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { nowIso, query, queryOne, transaction } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { emitWebhookEvent } from '@/lib/webhooks';

export const runtime = 'nodejs';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status }); }
async function authorize(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return { response: error('Invalid or revoked API key.', 401) } as const;
  if (!hasFullApiAccess(apiKey)) return { response: error('This API key has sending-only access.', 403) } as const;
  return { apiKey } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if ('response' in auth) return auth.response;
  const { id } = await context.params;
  const contact = await queryOne<{ id: string; unsubscribed_at: string | null; consent_status: string }>('SELECT id,unsubscribed_at,consent_status FROM contacts WHERE id=?', [id]);
  if (!contact) return error('Contact not found.', 404);
  const rows = await query<{ id: string; name: string; slug: string; description: string | null; subscribed_at: string | null; unsubscribed_at: string | null; consent_source: string | null; consented_at: string | null }>(`SELECT t.id,t.name,t.slug,t.description,ct.subscribed_at,ct.unsubscribed_at,ct.consent_source,ct.consented_at
    FROM topics t LEFT JOIN contact_topics ct ON ct.topic_id=t.id AND ct.contact_id=?
    WHERE t.disabled_at IS NULL ORDER BY t.name ASC`, [id]);
  return NextResponse.json({ object: 'list', data: rows.rows.map((topic) => ({ ...topic, subscribed: Boolean(topic.subscribed_at && !topic.unsubscribed_at && !contact.unsubscribed_at && contact.consent_status === 'opted_in') })) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if ('response' in auth) return auth.response;
  const { id } = await context.params;
  const contact = await queryOne<{ id: string; email: string; unsubscribed_at: string | null; consent_status: string; consent_source: string | null; consented_at: string | null }>('SELECT id,email,unsubscribed_at,consent_status,consent_source,consented_at FROM contacts WHERE id=?', [id]);
  if (!contact) return error('Contact not found.', 404);
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (!Array.isArray(body.topic_ids) || body.topic_ids.length > 100 || !body.topic_ids.every((topicId) => typeof topicId === 'string' && topicId.length <= 100)) return error('topic_ids must be an array of up to 100 topic IDs.', 400);
  const topicIds = [...new Set(body.topic_ids as string[])];
  if (topicIds.length !== body.topic_ids.length) return error('topic_ids cannot contain duplicates.', 400);
  const consentSource = body.consent_source === undefined ? '' : typeof body.consent_source === 'string' ? body.consent_source.trim() : '';
  if (topicIds.length && (consentSource.length < 2 || consentSource.length > 200 || /[\r\n]/.test(consentSource))) return error('A consent_source of 2 to 200 single-line characters is required to subscribe to topics.', 400);
  if (topicIds.length) {
    const placeholders = topicIds.map(() => '?').join(',');
    const topics = await query<{ id: string }>(`SELECT id FROM topics WHERE disabled_at IS NULL AND id IN (${placeholders})`, topicIds);
    if (topics.rows.length !== topicIds.length) return error('One or more topics are missing or archived.', 404);
  }
  const existing = await query<{ topic_id: string; subscribed_at: string | null; unsubscribed_at: string | null; consent_source: string | null; consented_at: string | null }>('SELECT topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at FROM contact_topics WHERE contact_id=?', [id]);
  const selected = new Set(topicIds);
  const timestamp = nowIso();
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  for (const topic of existing.rows) {
    if (!selected.has(topic.topic_id) && topic.unsubscribed_at === null) statements.push({ sql: 'UPDATE contact_topics SET unsubscribed_at=? WHERE contact_id=? AND topic_id=? AND unsubscribed_at IS NULL', params: [timestamp, id, topic.topic_id] });
  }
  for (const topicId of topicIds) {
    const previous = existing.rows.find((topic) => topic.topic_id === topicId);
    const remainsActive = Boolean(previous?.subscribed_at && !previous.unsubscribed_at && !contact.unsubscribed_at && contact.consent_status === 'opted_in');
    const topicSource = remainsActive ? previous?.consent_source ?? consentSource : consentSource;
    const topicConsentedAt = remainsActive ? previous?.consented_at ?? timestamp : timestamp;
    statements.push({
      sql: remainsActive
        ? `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at) VALUES(?,?,?,NULL,?,?)
          ON CONFLICT(contact_id,topic_id) DO UPDATE SET unsubscribed_at=NULL`
        : `INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at) VALUES(?,?,?,NULL,?,?)
          ON CONFLICT(contact_id,topic_id) DO UPDATE SET subscribed_at=excluded.subscribed_at,unsubscribed_at=NULL,consent_source=excluded.consent_source,consented_at=excluded.consented_at`,
      params: [id, topicId, remainsActive ? previous?.subscribed_at : timestamp, topicSource, topicConsentedAt],
    });
  }
  if (topicIds.length) statements.push({ sql: "UPDATE contacts SET unsubscribed_at=NULL,consent_status='opted_in',consent_source=CASE WHEN consent_status='opted_in' AND unsubscribed_at IS NULL THEN consent_source ELSE ? END,consented_at=CASE WHEN consent_status='opted_in' AND unsubscribed_at IS NULL THEN consented_at ELSE ? END,updated_at=? WHERE id=?", params: [consentSource, timestamp, timestamp, id] });
  else statements.push({ sql: 'UPDATE contacts SET updated_at=? WHERE id=?', params: [timestamp, id] });
  await transaction(statements);
  const changedSubscriptions = topicIds.some((topicId) => {
    const previous = existing.rows.find((topic) => topic.topic_id === topicId);
    return !previous?.subscribed_at || Boolean(previous.unsubscribed_at) || Boolean(contact.unsubscribed_at) || contact.consent_status !== 'opted_in';
  }) || existing.rows.some((topic) => topic.unsubscribed_at === null && !selected.has(topic.topic_id));
  if (topicIds.length && changedSubscriptions) {
    await emitWebhookEvent(auth.apiKey.id, 'contact.subscribed', { contact_id: id, email: contact.email, topic_ids: topicIds, consent_source: consentSource, consented_at: timestamp });
  } else if (existing.rows.some((topic) => topic.unsubscribed_at === null)) {
    await emitWebhookEvent(auth.apiKey.id, 'contact.unsubscribed', { contact_id: id, email: contact.email, topic_ids: existing.rows.map((topic) => topic.topic_id), unsubscribed_at: timestamp });
  }
  return GET(new Request(request.url, { headers: request.headers }), context);
}
