import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type EmailRow = { id: string; from_address: string; to_json: string; subject: string; status: string; error_message: string | null; provider_id: string | null; scheduled_at: string | null; created_at: string; open_count: number; click_count: number };
const statuses = new Set(['queued', 'scheduled', 'processing', 'sent', 'failed', 'suppressed', 'canceled']);
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
function escapeLike(value: string) { return value.replace(/[!%_]/g, '!$&'); }
function filtersFor(url: URL) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.trim().slice(0, 200) ?? '';
  if (status) { clauses.push('e.status=?'); params.push(status); }
  if (search) {
    clauses.push("(LOWER(e.to_json) LIKE ? ESCAPE '!' OR LOWER(COALESCE(e.cc_json,'')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(e.bcc_json,'')) LIKE ? ESCAPE '!' OR LOWER(e.from_address) LIKE ? ESCAPE '!' OR LOWER(e.subject) LIKE ? ESCAPE '!')");
    const term = `%${escapeLike(search.toLowerCase())}%`;
    params.push(term, term, term, term, term);
  }
  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
}

export async function GET(request: Request) {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
  const status = url.searchParams.get('status');
  if (status && !statuses.has(status)) return error('status is not a supported email state.', 400);
  if (url.searchParams.get('search')?.length && url.searchParams.get('search')!.length > 200) return error('search must be 200 characters or fewer.', 400);
  const after = url.searchParams.get('after');
  if (after !== null && !after) return error('after must be a non-empty email ID.', 400);
  const { where, params } = filtersFor(url);
  const totalResult = await queryOne<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS count FROM emails e WHERE ${where}`, params);
  let rows: EmailRow[];
  if (after) {
    const cursor = await queryOne<{ id: string; created_at: string }>(`SELECT e.id,e.created_at FROM emails e WHERE e.id=? AND ${where}`, [after, ...params]);
    if (!cursor) return error('after must be an email ID available in this filtered view.', 400);
    rows = (await query<EmailRow>(`SELECT e.id,e.from_address,e.to_json,e.subject,e.status,e.error_message,e.provider_id,e.scheduled_at,e.created_at,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.opened') AS INTEGER) AS open_count,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.clicked') AS INTEGER) AS click_count
      FROM emails e WHERE ${where} AND (e.created_at<? OR (e.created_at=? AND e.id<?)) ORDER BY e.created_at DESC,e.id DESC LIMIT ?`, [...params, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<EmailRow>(`SELECT e.id,e.from_address,e.to_json,e.subject,e.status,e.error_message,e.provider_id,e.scheduled_at,e.created_at,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.opened') AS INTEGER) AS open_count,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.clicked') AS INTEGER) AS click_count
      FROM emails e WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ?`, [...params, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((row) => ({ ...row, to: parseRecipients(row.to_json), to_json: undefined }));
  return NextResponse.json({ object: 'list', data, total: Number(totalResult?.count ?? 0), has_more: hasMore, ...(hasMore ? { next_after: rows[limit - 1]?.id } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

function parseRecipients(value: string) { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
