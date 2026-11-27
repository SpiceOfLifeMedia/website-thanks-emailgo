import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { inboxFolders, makeMessagePreview, normalizeFolder, searchClause } from '@/lib/inbox-threads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type ThreadRow = {
  thread_id: string; folder: string | null; inbox_address: string | null; is_read: number | null; labels_json: string | null;
  sender: string; recipients_json: string; subject: string; preview: string | null;
  updated_at: string; direction: 'received' | 'sent'; message_count: number | string;
  counterpart: string; inbox_recipients_json: string | null;
};
type Mailbox = { name?: string; address: string };

const messageCte = `WITH messages AS (
  SELECT r.id,COALESCE(r.thread_id,r.id) AS thread_id,r.api_key_id,r.from_address AS sender,r.to_json AS recipients_json,
    r.subject,COALESCE(r.text_body,r.html_body,'') AS preview,r.received_at AS updated_at,'received' AS direction
  FROM received_emails r
  UNION ALL
  SELECT e.id,e.thread_id,e.api_key_id,e.from_address,e.to_json,e.subject,COALESCE(e.text_body,e.html_body,''),e.created_at,'sent'
  FROM emails e WHERE e.thread_id IS NOT NULL AND e.status='sent'
), ranked AS (
  SELECT messages.*,ROW_NUMBER() OVER(PARTITION BY thread_id ORDER BY updated_at DESC,id DESC) AS latest_rank,
    COUNT(*) OVER(PARTITION BY thread_id) AS message_count
  FROM messages
)`;

function arrayValue(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function mailbox(value: string): Mailbox {
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
  return match ? { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2].trim() } : { address: value.trim() };
}

function likeTerm(value: string) {
  return `%${value.toLowerCase().replace(/[!%_]/g, '!$&')}%`;
}

async function listMeta() {
  const [recipientRows, labelRows, countRows] = await Promise.all([
    query<{ to_json: string }>('SELECT DISTINCT to_json FROM received_emails'),
    query<{ labels_json: string }>("SELECT labels_json FROM inbox_threads WHERE labels_json IS NOT NULL AND labels_json<>'[]'"),
    query<{ folder: string; unread_count: number | string }>(`${messageCte}
      SELECT COALESCE(threads.folder,'inbox') AS folder,
        CAST(SUM(CASE WHEN COALESCE(threads.is_read,0)=0 THEN 1 ELSE 0 END) AS INTEGER) AS unread_count
      FROM ranked LEFT JOIN inbox_threads threads ON threads.id=ranked.thread_id
      WHERE ranked.latest_rank=1 GROUP BY COALESCE(threads.folder,'inbox')`),
  ]);

  const inboxes = new Map<string, Mailbox>();
  for (const row of recipientRows.rows) for (const raw of arrayValue(row.to_json)) {
    const entry = mailbox(raw);
    const key = entry.address.toLowerCase();
    if (key && !inboxes.has(key)) inboxes.set(key, entry);
  }
  const labels = new Map<string, string>();
  for (const row of labelRows.rows) for (const name of arrayValue(row.labels_json)) {
    const key = name.toLocaleLowerCase();
    if (key && !labels.has(key)) labels.set(key, name);
  }
  const unreadByFolder = new Map(countRows.rows.map(row => [row.folder, Number(row.unread_count)]));
  return {
    inboxes: [...inboxes.values()].map(item => ({ id: item.address.toLowerCase(), address: item.address, ...(item.name ? { name: item.name } : {}) })),
    labels: [...labels.values()].map(name => ({ id: name, name })),
    folders: inboxFolders.map(id => ({ id, unreadCount: unreadByFolder.get(id) ?? 0 })),
  };
}

export async function GET(request: Request) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'limit must be an integer from 1 to 100.' }, { status: 400, headers: privateHeaders });
  const folder = normalizeFolder(url.searchParams.get('folder') ?? 'inbox');
  if (!folder || !inboxFolders.includes(folder)) return NextResponse.json({ error: 'folder must be inbox, sent, archive, spam or trash.' }, { status: 400, headers: privateHeaders });
  const search = url.searchParams.get('search')?.trim() ?? '';
  if (search.length > 200) return NextResponse.json({ error: 'search must be 200 characters or fewer.' }, { status: 400, headers: privateHeaders });
  const selectedInbox = url.searchParams.get('inbox')?.trim().toLowerCase() ?? '';
  if (selectedInbox && (selectedInbox.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(selectedInbox))) {
    return NextResponse.json({ error: 'inbox must be a valid email address.' }, { status: 400, headers: privateHeaders });
  }
  const after = url.searchParams.get('after');
  if (after !== null && !after) return NextResponse.json({ error: 'after must be a non-empty thread ID.' }, { status: 400, headers: privateHeaders });

  const conditions = ['ranked.latest_rank=1'];
  const params: Array<string | number> = [];
  if (folder === 'sent') {
    conditions.push("EXISTS (SELECT 1 FROM emails sent WHERE sent.api_key_id=ranked.api_key_id AND sent.thread_id=ranked.thread_id AND sent.status='sent')");
    conditions.push("COALESCE(threads.folder,'inbox') NOT IN ('spam','trash','archive')");
  } else {
    conditions.push('COALESCE(threads.folder,\'inbox\')=?');
    params.push(folder);
  }
  if (selectedInbox) {
    conditions.push(`(LOWER(COALESCE(threads.inbox_address,''))=? OR EXISTS (SELECT 1 FROM received_emails inbox_match
      WHERE inbox_match.api_key_id=ranked.api_key_id AND COALESCE(inbox_match.thread_id,inbox_match.id)=ranked.thread_id
        AND (LOWER(COALESCE(inbox_match.to_json,'')) LIKE ? ESCAPE '!'
          OR LOWER(COALESCE(inbox_match.to_json,'')) LIKE ? ESCAPE '!')))`);
    params.push(selectedInbox, likeTerm(`"${selectedInbox}"`), likeTerm(`<${selectedInbox}>`));
  }
  if (search) {
    const clause = searchClause(search);
    if (clause.error) return NextResponse.json({ error: clause.error }, { status: 400, headers: privateHeaders });
    conditions.push(clause.sql);
    params.push(...clause.params);
  }
  const where = conditions.join(' AND ');
  const joins = 'FROM ranked LEFT JOIN inbox_threads threads ON threads.id=ranked.thread_id';
  const total = await queryOne<{ count: number | string }>(`${messageCte} SELECT CAST(COUNT(*) AS INTEGER) AS count ${joins} WHERE ${where}`, params);

  let cursor: { updated_at: string; thread_id: string } | undefined;
  if (after) {
    cursor = await queryOne<{ updated_at: string; thread_id: string }>(`${messageCte}
      SELECT ranked.updated_at,ranked.thread_id ${joins} WHERE ${where} AND ranked.thread_id=?`, [...params, after]);
    if (!cursor) return NextResponse.json({ error: 'after must be a thread in this inbox view.' }, { status: 400, headers: privateHeaders });
  }
  const cursorWhere = cursor ? ' AND (ranked.updated_at<? OR (ranked.updated_at=? AND ranked.thread_id<?))' : '';
  const cursorParams = cursor ? [cursor.updated_at, cursor.updated_at, cursor.thread_id] : [];
  const result = await query<ThreadRow>(`${messageCte}
    SELECT ranked.thread_id,threads.folder,threads.inbox_address,threads.is_read,threads.labels_json,ranked.sender,ranked.recipients_json,
      ranked.subject,ranked.preview,ranked.updated_at,ranked.direction,ranked.message_count,
      COALESCE((SELECT original.from_address FROM received_emails original
        WHERE original.api_key_id=ranked.api_key_id AND COALESCE(original.thread_id,original.id)=ranked.thread_id
        ORDER BY original.received_at ASC,original.id ASC LIMIT 1),ranked.sender) AS counterpart,
      (SELECT original.to_json FROM received_emails original
        WHERE original.api_key_id=ranked.api_key_id AND COALESCE(original.thread_id,original.id)=ranked.thread_id
        ORDER BY original.received_at ASC,original.id ASC LIMIT 1) AS inbox_recipients_json
    ${joins} WHERE ${where}${cursorWhere} ORDER BY ranked.updated_at DESC,ranked.thread_id DESC LIMIT ?`, [...params, ...cursorParams, limit + 1]);
  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0, limit);
  const data = page.map((row) => {
    const counterpart = mailbox(row.counterpart || row.sender);
    const inboxId = row.inbox_address || arrayValue(row.inbox_recipients_json)[0];
    return {
      id: row.thread_id,
      inbox_id: inboxId ? mailbox(inboxId).address.toLowerCase() : '',
      folder: row.folder ?? 'inbox',
      subject: row.subject,
      unread: !row.is_read,
      labels: arrayValue(row.labels_json),
      counterpart,
      snippet: makeMessagePreview(row.preview, null),
      updated_at: row.updated_at,
      latest_direction: row.direction === 'sent' ? 'outbound' : 'inbound',
      message_count: Number(row.message_count),
    };
  });
  const unread = await queryOne<{ count: number | string }>(`${messageCte}
    SELECT CAST(COUNT(*) AS INTEGER) AS count ${joins} WHERE ${where} AND COALESCE(threads.is_read,0)=0`, params);
  const meta = await listMeta();
  return NextResponse.json({
    object: 'list', data, total: Number(total?.count ?? 0), unread: Number(unread?.count ?? 0), has_more: hasMore,
    ...(hasMore && page.length ? { next_after: page.at(-1)?.thread_id } : {}), ...meta,
  }, { headers: privateHeaders });
}
