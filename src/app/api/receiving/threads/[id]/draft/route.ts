import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { extractMailboxAddress, type InboxComposeMode } from '@/lib/inbox-thread-utils';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };
const modes = new Set<InboxComposeMode>(['reply', 'reply_all', 'forward']);
type Context = { params: Promise<{ id: string }> };
type ThreadOwner = { api_key_id: string; folder: string; inbox_address: string | null };
type DraftRow = {
  mode: InboxComposeMode;
  from_address: string;
  to_text: string;
  cc_text: string;
  bcc_text: string;
  subject: string;
  text_body: string;
  updated_at: string;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

async function readThread(threadId: string): Promise<ThreadOwner | null> {
  return queryOne<ThreadOwner>('SELECT api_key_id,folder,inbox_address FROM inbox_threads WHERE id=?', [threadId]) ?? null;
}

export async function GET(_request: Request, context: Context) {
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const thread = await readThread(id);
  if (!thread) return error('Thread not found.', 404);
  const row = await queryOne<DraftRow>('SELECT mode,from_address,to_text,cc_text,bcc_text,subject,text_body,updated_at FROM inbox_reply_drafts WHERE thread_id=? AND api_key_id=?', [id, thread.api_key_id]);
  const draft = row ? {
    mode: row.mode,
    from: row.from_address || thread.inbox_address || '',
    to: row.to_text,
    cc: row.cc_text,
    bcc: row.bcc_text,
    subject: row.subject,
    text: row.text_body,
    updated_at: row.updated_at,
  } : null;
  return NextResponse.json({ draft }, { headers: privateHeaders });
}

export async function PUT(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('Request body must use application/json.', 415);
  const parsed = await readJsonLimited(request, 524_800);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (typeof body.mode !== 'string' || !modes.has(body.mode as InboxComposeMode)) return error('mode must be reply, reply_all or forward.', 400);
  const from = extractMailboxAddress(body.from);
  if (!from) return error('from must be a valid email address.', 400);
  const to = typeof body.to === 'string' ? body.to : '';
  const cc = typeof body.cc === 'string' ? body.cc : '';
  const bcc = typeof body.bcc === 'string' ? body.bcc : '';
  const recipients = [to, cc, bcc];
  if (recipients.some((value) => typeof value !== 'string' || value.length > 10_000 || /[\r\n\u0000-\u001f\u007f]/.test(value))) {
    return error('Each recipient field must be 10,000 characters or fewer on one line.', 400);
  }
  if (typeof body.subject !== 'string' || body.subject.length > 998 || /[\r\n\u0000-\u001f\u007f]/.test(body.subject)) return error('subject must be 998 characters or fewer on one line.', 400);
  if (typeof body.text !== 'string' || body.text.length > 500_000 || body.text.includes('\u0000')) return error('text must be 500,000 characters or fewer.', 400);

  const { id } = await context.params;
  const thread = await readThread(id);
  if (!thread) return error('Thread not found.', 404);
  if (thread.folder === 'spam' || thread.folder === 'trash') return error('Move this conversation to Inbox before saving a draft.', 409);
  const updatedAt = nowIso();
  await execute(`INSERT INTO inbox_reply_drafts(thread_id,api_key_id,mode,from_address,to_text,cc_text,bcc_text,subject,text_body,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET mode=excluded.mode,from_address=excluded.from_address,to_text=excluded.to_text,
      cc_text=excluded.cc_text,bcc_text=excluded.bcc_text,subject=excluded.subject,text_body=excluded.text_body,updated_at=excluded.updated_at
    WHERE inbox_reply_drafts.api_key_id=excluded.api_key_id`, [
    id, thread.api_key_id, body.mode, from, to, cc, bcc, body.subject, body.text, updatedAt,
  ]);
  const saved = await queryOne<DraftRow>('SELECT mode,from_address,to_text,cc_text,bcc_text,subject,text_body,updated_at FROM inbox_reply_drafts WHERE thread_id=? AND api_key_id=?', [id, thread.api_key_id]);
  if (!saved) return error('Could not save this draft.', 500);
  return NextResponse.json({ draft: {
    mode: saved.mode,
    from: saved.from_address,
    to: saved.to_text,
    cc: saved.cc_text,
    bcc: saved.bcc_text,
    subject: saved.subject,
    text: saved.text_body,
    updated_at: saved.updated_at,
  } }, { headers: privateHeaders });
}

export async function DELETE(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const { id } = await context.params;
  const thread = await readThread(id);
  if (!thread) return error('Thread not found.', 404);
  await execute('DELETE FROM inbox_reply_drafts WHERE thread_id=? AND api_key_id=?', [id, thread.api_key_id]);
  return NextResponse.json({ id, deleted: true }, { headers: privateHeaders });
}
