import { queryOne } from '@/lib/database';

export type SegmentFilters = {
  tags_all?: string[];
  tags_any?: string[];
  consent_status?: 'unknown' | 'opted_in';
  unsubscribed?: boolean;
};

export type SegmentRow = {
  id: string;
  name: string;
  filters_json: string;
  created_at: string;
  updated_at: string;
};

export function parseSegmentFilters(value: unknown): { ok: true; filters: SegmentFilters } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'filters must be an object.' };
  const body = value as Record<string, unknown>;
  const tagsAll = body.tags_all === undefined ? [] : body.tags_all;
  const tagsAny = body.tags_any === undefined ? [] : body.tags_any;
  const validTags = (tags: unknown) => Array.isArray(tags) && tags.length <= 20 && tags.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag));
  if (!validTags(tagsAll)) return { ok: false, error: 'tags_all must contain up to 20 short tag names.' };
  if (!validTags(tagsAny)) return { ok: false, error: 'tags_any must contain up to 20 short tag names.' };
  const all = [...new Set(tagsAll as string[])];
  const any = [...new Set(tagsAny as string[])];
  if (all.length !== (tagsAll as string[]).length || any.length !== (tagsAny as string[]).length) return { ok: false, error: 'Segment tag filters cannot contain duplicate values.' };
  if (all.some((tag) => any.includes(tag))) return { ok: false, error: 'A tag cannot appear in both tags_all and tags_any.' };
  if (body.consent_status !== undefined && body.consent_status !== 'unknown' && body.consent_status !== 'opted_in') return { ok: false, error: 'consent_status must be unknown or opted_in.' };
  if (body.unsubscribed !== undefined && typeof body.unsubscribed !== 'boolean') return { ok: false, error: 'unsubscribed must be a boolean.' };
  if (!all.length && !any.length && body.consent_status === undefined && body.unsubscribed === undefined) return { ok: false, error: 'Add a tag, consent or unsubscribe filter. Empty filters would match every contact.' };
  return {
    ok: true,
    filters: {
      ...(all.length ? { tags_all: all } : {}),
      ...(any.length ? { tags_any: any } : {}),
      ...(body.consent_status ? { consent_status: body.consent_status as 'unknown' | 'opted_in' } : {}),
      ...(body.unsubscribed !== undefined ? { unsubscribed: body.unsubscribed as boolean } : {}),
    },
  };
}

function escapeLike(value: string) {
  return value.replace(/[!%_]/g, '!$&');
}

export function segmentWhere(filters: SegmentFilters) {
  const clauses: string[] = [];
  const params: Array<string | number | null> = [];
  for (const tag of filters.tags_all ?? []) {
    clauses.push("c.tags_json LIKE ? ESCAPE '!' ");
    params.push(`%${escapeLike(JSON.stringify(tag))}%`);
  }
  if (filters.tags_any?.length) {
    clauses.push(`(${filters.tags_any.map(() => "c.tags_json LIKE ? ESCAPE '!'").join(' OR ')})`);
    params.push(...filters.tags_any.map((tag) => `%${escapeLike(JSON.stringify(tag))}%`));
  }
  if (filters.consent_status !== undefined) {
    clauses.push('c.consent_status=?');
    params.push(filters.consent_status);
  }
  if (filters.unsubscribed !== undefined) clauses.push(filters.unsubscribed ? 'c.unsubscribed_at IS NOT NULL' : 'c.unsubscribed_at IS NULL');
  return { where: clauses.join(' AND '), params };
}

export async function countSegment(filters: SegmentFilters) {
  const { where, params } = segmentWhere(filters);
  const result = await queryOne<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS count FROM contacts c WHERE ${where}`, params);
  return Number(result?.count ?? 0);
}

export async function toSegment(row: SegmentRow) {
  let filters: SegmentFilters = {};
  try { filters = JSON.parse(row.filters_json) as SegmentFilters; } catch {}
  return { id: row.id, object: 'segment', name: row.name, filters, contacts_count: await countSegment(filters), created_at: row.created_at, updated_at: row.updated_at };
}
