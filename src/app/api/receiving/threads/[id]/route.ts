import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, query, queryOne, transaction } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { normalizeFolder, safeLabels } from '@/lib/inbox-threads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type ThreadState = { id: string; api_key_id: string; subject: string; inbox_address: string | null; folder: string; is_read: number; labels_json: string; created_at: string; updated_at: string };
type ReceivedRow = { id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null; subject: string; message_id: string | null; headers_json: string | null; text_body: string | null; html_body: string | null; received_at: string };
type SentRow = { id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null; subject: string; message_id: string | null; headers_json: string | null; text_body: string | null; html_body: string | null; created_at: string };
type Context = { params: Promise<{ id: string }> };
type Mailbox = { name?: string; address: string };

function jsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mailbox(value: string): Mailbox {
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
  return match ? { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2].trim() } : { address: value.trim() };
}

function headerValue(value: string | null, name: string) {
  const headers = jsonValue<Record<string, string>>(value, {});
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? '';
}

function plainBody(text: string | null, html: string | null) {
  if (text !== null) return text;
  return (html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

async function ensureThread(id: string): Promise<ThreadState | null> {
  const existing = await queryOne<ThreadState>('SELECT id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at FROM inbox_threads WHERE id=?', [id]);
  if (existing) {
    if (existing.inbox_address) return existing;
    const received = await queryOne<{ to_json: string }>(
      'SELECT to_json FROM received_emails WHERE id=? OR thread_id=? ORDER BY received_at ASC,id ASC LIMIT 1', [id, id],
    );
    const firstTo = jsonValue(received?.to_json, [] as string[])[0];
    const inboxAddress = typeof firstTo === 'string' ? mailbox(firstTo).address : '';
    if (inboxAddress) await execute('UPDATE inbox_threads SET inbox_address=? WHERE id=? AND inbox_address IS NULL', [inboxAddress, id]);
    return await queryOne<ThreadState>('SELECT id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at FROM inbox_threads WHERE id=?', [id]);
  }
  const received = await queryOne<{ id: string; api_key_id: string; thread_id: string | null; subject: string; to_json: string; received_at: string }>(
    'SELECT id,api_key_id,thread_id,subject,to_json,received_at FROM received_emails WHERE id=? OR thread_id=? ORDER BY received_at ASC,id ASC LIMIT 1', [id, id],
  );
  const sent = received ? undefined : await queryOne<{ id: string; api_key_id: string; thread_id: string | null; subject: string; to_json: string; created_at: string }>(
    "SELECT id,api_key_id,thread_id,subject,to_json,created_at FROM emails WHERE thread_id=? AND status='sent' ORDER BY created_at ASC,id ASC LIMIT 1", [id],
  );
  const source = received ?? sent;
  if (!source) return null;
  const timestamp = received ? received.received_at : sent!.created_at;
  const threadId = source.thread_id || source.id;
  const firstTo = jsonValue(source.to_json, [] as string[])[0];
  const row: ThreadState = { id: threadId, api_key_id: source.api_key_id, subject: source.subject, inbox_address: firstTo ? mailbox(firstTo).address : null, folder: 'inbox', is_read: 0, labels_json: '[]', created_at: timestamp, updated_at: timestamp };
  await execute(`INSERT INTO inbox_threads(id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at)
    VALUES(?,?,?,?,'inbox',0,'[]',?,?) ON CONFLICT(id) DO NOTHING`, [row.id, row.api_key_id, row.subject, row.inbox_address, row.created_at, row.updated_at]);
  if (received && !received.thread_id) await execute('UPDATE received_emails SET thread_id=? WHERE id=? AND api_key_id=? AND thread_id IS NULL', [row.id, received.id, row.api_key_id]);
  const latest = await queryOne<ThreadState>('SELECT id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at FROM inbox_threads WHERE id=?', [row.id]);
  return latest ?? null;
}

async function readThreadState(id: string): Promise<ThreadState | null> {
  const existing = await queryOne<ThreadState>('SELECT id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at FROM inbox_threads WHERE id=?', [id]);
  if (existing) return existing;
  const received = await queryOne<{ id: string; api_key_id: string; thread_id: string | null; subject: string; to_json: string; received_at: string }>(
    'SELECT id,api_key_id,thread_id,subject,to_json,received_at FROM received_emails WHERE id=? OR thread_id=? ORDER BY received_at ASC,id ASC LIMIT 1', [id, id],
  );
  const sent = received ? undefined : await queryOne<{ id: string; api_key_id: string; thread_id: string | null; subject: string; to_json: string; created_at: string }>(
    "SELECT id,api_key_id,thread_id,subject,to_json,created_at FROM emails WHERE (id=? OR thread_id=?) AND status='sent' ORDER BY created_at ASC,id ASC LIMIT 1", [id, id],
  );
  const source = received ?? sent;
  if (!source) return null;
  const timestamp = received ? received.received_at : sent!.created_at;
  const firstTo = jsonValue(source.to_json, [] as string[])[0];
  return {
    id: source.thread_id || source.id,
    api_key_id: source.api_key_id,
    subject: source.subject,
    inbox_address: firstTo ? mailbox(firstTo).address : null,
    folder: 'inbox', is_read: 0, labels_json: '[]', created_at: timestamp, updated_at: timestamp,
  };
}

export async function GET(_request: Request, context: Context) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  const state = await readThreadState(id);
  if (!state) return NextResponse.json({ error: 'Thread not found.' }, { status: 404, headers: privateHeaders });
  const received = await query<ReceivedRow>(`SELECT id,from_address,to_json,cc_json,bcc_json,subject,message_id,headers_json,text_body,html_body,received_at
    FROM received_emails WHERE api_key_id=? AND (thread_id=? OR (thread_id IS NULL AND id=?)) ORDER BY received_at ASC,id ASC`, [state.api_key_id, state.id, state.id]);
  const sent = await query<SentRow>(`SELECT id,from_address,to_json,cc_json,bcc_json,subject,message_id,headers_json,text_body,html_body,created_at
    FROM emails WHERE api_key_id=? AND thread_id=? AND status='sent' ORDER BY created_at ASC,id ASC`, [state.api_key_id, state.id]);
  const receivedIds = received.rows.map((row) => row.id);
  const attachments = receivedIds.length
    ? await query<{ id: string; received_email_id: string; filename: string; content_type: string; byte_length: number }>(
      `SELECT id,received_email_id,filename,content_type,byte_length FROM received_email_attachments WHERE received_email_id IN (${receivedIds.map(() => '?').join(',')}) ORDER BY created_at,id`, receivedIds,
    )
    : { rows: [] as Array<{ id: string; received_email_id: string; filename: string; content_type: string; byte_length: number }>, rowCount: 0 };
  const attachmentsFor = new Map<string, Array<{ id: string; filename: string; content_type: string; byte_length: number; download_url: string }>>();
  for (const attachment of attachments.rows) {
    const list = attachmentsFor.get(attachment.received_email_id) ?? [];
    list.push({ id: attachment.id, filename: attachment.filename, content_type: attachment.content_type, byte_length: attachment.byte_length, download_url: `/api/receiving/${encodeURIComponent(attachment.received_email_id)}/attachments/${encodeURIComponent(attachment.id)}` });
    attachmentsFor.set(attachment.received_email_id, list);
  }
  const messages = [
    ...received.rows.map((row) => ({
      id: row.id, direction: 'inbound' as const, from: mailbox(row.from_address), to: jsonValue(row.to_json, [] as string[]).map(mailbox),
      ...(row.cc_json ? { cc: jsonValue(row.cc_json, [] as string[]).map(mailbox) } : {}),
      ...(row.bcc_json ? { bcc: jsonValue(row.bcc_json, [] as string[]).map(mailbox) } : {}),
      ...(headerValue(row.headers_json, 'reply-to') ? { reply_to: mailbox(headerValue(row.headers_json, 'reply-to')) } : {}),
      sent_at: row.received_at, text: plainBody(row.text_body, row.html_body), html_preview: row.html_body,
      attachments: (attachmentsFor.get(row.id) ?? []).map(attachment => ({ id: attachment.id, filename: attachment.filename, content_type: attachment.content_type, byte_length: attachment.byte_length, download_url: attachment.download_url })),
    })),
    ...sent.rows.map((row) => ({
      id: row.id, direction: 'outbound' as const, from: mailbox(row.from_address), to: jsonValue(row.to_json, [] as string[]).map(mailbox),
      ...(row.cc_json ? { cc: jsonValue(row.cc_json, [] as string[]).map(mailbox) } : {}),
      ...(row.bcc_json ? { bcc: jsonValue(row.bcc_json, [] as string[]).map(mailbox) } : {}),
      sent_at: row.created_at, text: plainBody(row.text_body, row.html_body),
    })),
  ].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
  const firstInbound = messages.find((message) => message.direction === 'inbound');
  const inboxAddress = state.inbox_address ?? firstInbound?.to[0]?.address ?? '';
  const counterpart = firstInbound?.from ?? (messages[0]?.to[0] ?? { address: '' });
  return NextResponse.json({
    id: state.id, object: 'inbox_thread', inbox_id: inboxAddress.toLowerCase(), subject: state.subject, folder: state.folder,
    unread: !state.is_read, labels: jsonValue(state.labels_json, [] as string[]), counterpart, messages,
  }, { headers: privateHeaders });
}

export async function PATCH(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403, headers: privateHeaders });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 16_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400, headers: privateHeaders });
  const body = parsed.value as Record<string, unknown>;
  const hasFolder = Object.hasOwn(body, 'folder');
  const hasRead = Object.hasOwn(body, 'is_read');
  const hasLabels = Object.hasOwn(body, 'labels');
  if (!hasFolder && !hasRead && !hasLabels) return NextResponse.json({ error: 'Set folder, is_read or labels.' }, { status: 400, headers: privateHeaders });
  const folder = hasFolder ? normalizeFolder(body.folder) : null;
  if (hasFolder && (!folder || folder === 'sent')) return NextResponse.json({ error: 'folder must be inbox, archive, spam or trash.' }, { status: 400, headers: privateHeaders });
  if (hasRead && typeof body.is_read !== 'boolean') return NextResponse.json({ error: 'is_read must be a boolean.' }, { status: 400, headers: privateHeaders });
  const labels = hasLabels ? safeLabels(body.labels) : null;
  if (hasLabels && !labels) return NextResponse.json({ error: 'labels must contain up to 20 names of 1 to 40 characters.' }, { status: 400, headers: privateHeaders });
  const { id } = await context.params;
  const state = await ensureThread(id);
  if (!state) return NextResponse.json({ error: 'Thread not found.' }, { status: 404, headers: privateHeaders });
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [];
  if (hasFolder) statements.push({ sql: 'UPDATE inbox_threads SET folder=?,updated_at=? WHERE id=? AND api_key_id=?', params: [folder!, nowIso(), state.id, state.api_key_id] });
  if (hasRead) statements.push({ sql: 'UPDATE inbox_threads SET is_read=? WHERE id=? AND api_key_id=?', params: [body.is_read ? 1 : 0, state.id, state.api_key_id] });
  if (hasLabels) statements.push({ sql: 'UPDATE inbox_threads SET labels_json=?,updated_at=? WHERE id=? AND api_key_id=?', params: [JSON.stringify(labels), nowIso(), state.id, state.api_key_id] });
  if (statements.length) await transaction(statements);
  const updated = await queryOne<{ folder: string; is_read: number; labels_json: string }>('SELECT folder,is_read,labels_json FROM inbox_threads WHERE id=? AND api_key_id=?', [state.id, state.api_key_id]);
  if (!updated) return NextResponse.json({ error: 'Thread not found.' }, { status: 404, headers: privateHeaders });
  return NextResponse.json({ id: state.id, folder: updated.folder, unread: !updated.is_read, labels: jsonValue(updated.labels_json, [] as string[]) }, { headers: privateHeaders });
}
