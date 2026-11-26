import { queryOne } from '@/lib/database';

export type TopicRow = { id: string; name: string; slug: string; description: string | null; created_at: string; updated_at: string };

export function validateTopicBody(value: unknown, current?: TopicRow) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false as const, error: 'Request body must be a JSON object.' };
  const body = value as Record<string, unknown>;
  const name = body.name === undefined && current ? current.name : typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80 || /[\r\n]/.test(name)) return { ok: false as const, error: 'name must be 1 to 80 single-line characters.' };
  const description = body.description === undefined && current ? current.description : body.description === undefined || body.description === null ? null : typeof body.description === 'string' ? body.description.trim() : undefined;
  if (description === undefined || (description !== null && description.length > 500)) return { ok: false as const, error: 'description must be null or up to 500 characters.' };
  const requestedSlug = body.slug === undefined && current ? current.slug : body.slug === undefined ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!requestedSlug || requestedSlug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) return { ok: false as const, error: 'slug must contain lowercase letters, numbers and single hyphens.' };
  return { ok: true as const, value: { name, slug: requestedSlug, description } };
}

export async function toTopic(row: TopicRow) {
  const count = await queryOne<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS count FROM contact_topics ct
    JOIN contacts c ON c.id=ct.contact_id WHERE ct.topic_id=? AND ct.subscribed_at IS NOT NULL
      AND ct.unsubscribed_at IS NULL AND c.unsubscribed_at IS NULL AND c.consent_status='opted_in'`, [row.id]);
  return { id: row.id, object: 'topic', name: row.name, slug: row.slug, description: row.description, subscribers_count: Number(count?.count ?? 0), created_at: row.created_at, updated_at: row.updated_at };
}
