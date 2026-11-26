import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin } from '@/lib/auth';
import { verifyContactPreferenceToken } from '@/lib/contact-preferences';
import { nowIso, query, queryOne, transaction } from '@/lib/database';
import { unsubscribeContact } from '@/lib/contact-preferences';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type PreferenceContext = { params: Promise<{ token: string }> };
type ContactPreferenceRow = { id: string; email: string; name: string | null; consent_status: string; unsubscribed_at: string | null };

async function resolveContact(token: string) {
  const identity = verifyContactPreferenceToken(token);
  if (!identity) return null;
  const contact = await queryOne<ContactPreferenceRow>('SELECT id,email,name,consent_status,unsubscribed_at FROM contacts WHERE id=?', [identity.contactId]);
  if (!contact || contact.email !== identity.email) return null;
  return contact;
}

export async function GET(_request: Request, context: PreferenceContext) {
  const { token } = await context.params;
  const contact = await resolveContact(token);
  if (!contact) return NextResponse.json({ error: 'This preference link is invalid.' }, { status: 404, headers: privateHeaders });
  const rows = await query<{ id: string; name: string; slug: string; description: string | null; subscribed_at: string | null; unsubscribed_at: string | null }>(`SELECT t.id,t.name,t.slug,t.description,ct.subscribed_at,ct.unsubscribed_at
    FROM topics t LEFT JOIN contact_topics ct ON ct.topic_id=t.id AND ct.contact_id=?
    WHERE t.disabled_at IS NULL ORDER BY t.name ASC`, [contact.id]);
  return NextResponse.json({
    contact: { email: contact.email, name: contact.name, unsubscribed: Boolean(contact.unsubscribed_at), consent_status: contact.consent_status },
    topics: rows.rows.map((topic) => ({ id: topic.id, name: topic.name, slug: topic.slug, description: topic.description, subscribed: Boolean(topic.subscribed_at && !topic.unsubscribed_at && !contact.unsubscribed_at && contact.consent_status === 'opted_in') })),
  }, { headers: privateHeaders });
}

export async function POST(request: Request, context: PreferenceContext) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  const { token } = await context.params;
  const contact = await resolveContact(token);
  if (!contact) return NextResponse.json({ error: 'This preference link is invalid.' }, { status: 404, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400, headers: privateHeaders });
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['topic_ids', 'global_unsubscribe', 'confirm_resubscribe'].includes(key))) return NextResponse.json({ error: 'Only topic_ids, global_unsubscribe and confirm_resubscribe are supported.' }, { status: 400, headers: privateHeaders });
  if (!Array.isArray(body.topic_ids) || body.topic_ids.length > 100 || !body.topic_ids.every((id) => typeof id === 'string' && id.length <= 100)) return NextResponse.json({ error: 'topic_ids must be an array of up to 100 topic IDs.' }, { status: 400, headers: privateHeaders });
  const topicIds = [...new Set(body.topic_ids as string[])];
  if (topicIds.length !== body.topic_ids.length) return NextResponse.json({ error: 'topic_ids cannot contain duplicates.' }, { status: 400, headers: privateHeaders });
  if (body.global_unsubscribe !== undefined && typeof body.global_unsubscribe !== 'boolean') return NextResponse.json({ error: 'global_unsubscribe must be a boolean.' }, { status: 400, headers: privateHeaders });
  if (body.confirm_resubscribe !== undefined && typeof body.confirm_resubscribe !== 'boolean') return NextResponse.json({ error: 'confirm_resubscribe must be a boolean.' }, { status: 400, headers: privateHeaders });
  if (body.global_unsubscribe === true) {
    await unsubscribeContact(contact.id);
    return NextResponse.json({ updated: true, unsubscribed: true }, { headers: privateHeaders });
  }
  if (contact.unsubscribed_at && topicIds.length && body.confirm_resubscribe !== true) return NextResponse.json({ error: 'Confirm that you want to opt in again before subscribing to topics.' }, { status: 409, headers: privateHeaders });
  if (topicIds.length) {
    const placeholders = topicIds.map(() => '?').join(',');
    const activeTopics = await query<{ id: string }>(`SELECT id FROM topics WHERE disabled_at IS NULL AND id IN (${placeholders})`, topicIds);
    if (activeTopics.rows.length !== topicIds.length) return NextResponse.json({ error: 'One or more topics are missing or archived.' }, { status: 404, headers: privateHeaders });
  }
  const existing = await query<{ topic_id: string; subscribed_at: string | null; unsubscribed_at: string | null; consent_source: string | null; consented_at: string | null }>('SELECT topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at FROM contact_topics WHERE contact_id=?', [contact.id]);
  const selected = new Set(topicIds);
  const timestamp = nowIso();
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  for (const topic of existing.rows) {
    if (!selected.has(topic.topic_id) && topic.unsubscribed_at === null) statements.push({ sql: 'UPDATE contact_topics SET unsubscribed_at=? WHERE contact_id=? AND topic_id=? AND unsubscribed_at IS NULL', params: [timestamp, contact.id, topic.topic_id] });
  }
  for (const topicId of topicIds) {
    const previous = existing.rows.find((topic) => topic.topic_id === topicId);
    const remainsActive = Boolean(previous?.subscribed_at && !previous.unsubscribed_at && !contact.unsubscribed_at && contact.consent_status === 'opted_in');
    statements.push({
      sql: remainsActive
        ? 'INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at) VALUES(?,?,?,NULL,?,?) ON CONFLICT(contact_id,topic_id) DO UPDATE SET unsubscribed_at=NULL'
        : 'INSERT INTO contact_topics(contact_id,topic_id,subscribed_at,unsubscribed_at,consent_source,consented_at) VALUES(?,?,?,NULL,?,?) ON CONFLICT(contact_id,topic_id) DO UPDATE SET subscribed_at=excluded.subscribed_at,unsubscribed_at=NULL,consent_source=excluded.consent_source,consented_at=excluded.consented_at',
      params: [contact.id, topicId, remainsActive ? previous?.subscribed_at : timestamp, remainsActive ? previous?.consent_source ?? 'email_preference_center' : 'email_preference_center', remainsActive ? previous?.consented_at ?? timestamp : timestamp],
    });
  }
  if (topicIds.length) statements.push({ sql: "UPDATE contacts SET unsubscribed_at=NULL,consent_status='opted_in',consent_source=CASE WHEN consent_status='opted_in' AND unsubscribed_at IS NULL THEN consent_source ELSE 'email_preference_center' END,consented_at=CASE WHEN consent_status='opted_in' AND unsubscribed_at IS NULL THEN consented_at ELSE ? END,updated_at=? WHERE id=?", params: [timestamp, timestamp, contact.id] });
  else statements.push({ sql: 'UPDATE contacts SET updated_at=? WHERE id=?', params: [timestamp, contact.id] });
  await transaction(statements);
  return NextResponse.json({ updated: true, unsubscribed: false }, { headers: privateHeaders });
}
