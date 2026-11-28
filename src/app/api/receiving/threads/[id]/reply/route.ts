import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { consumeApiRequestLimit, execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { findSuppressedAddresses } from '@/lib/suppressions';
import { sendThroughSmtp } from '@/lib/smtp';
import { relayMessageIdFromResponse } from '@/lib/ses-events';
import { emitWebhookEvent } from '@/lib/webhooks';
import { recordEmailSentActivity } from '@/lib/email-activity';
import { boundedMessageReferences, composeRequestHash, composeSubject, extractMailboxAddress, parseInboxRecipientText, parseMessageIds, replyAllRecipients, replyRequestHash, type InboxComposeMode } from '@/lib/inbox-thread-utils';
import { withApiRateLimitHeaders } from '@/lib/rate-limit';
import { resolvePlainText } from '@/lib/plain-text';
import { DEFAULT_WORKSPACE_ID } from '@/lib/workspaces';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
type Context = { params: Promise<{ id: string }> };
type ThreadMessage = { id: string; direction: string; from_address: string; to_json: string; cc_json: string | null; subject: string; message_id: string | null; headers_json: string | null; text_body: string | null; html_body: string | null; created_at: string };
type Replay = { request_hash: string; id: string; status: string; message_id: string | null; subject: string; created_at: string };

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mailbox(value: string) {
  const match = /<([^<>]+)>$/.exec(value.trim());
  return (match?.[1] ?? value).trim();
}

function replayResponse(previous: Replay, replayed = true) {
  if (previous.status === 'failed') return error('The reply could not be handed off. Check the message details before trying again.', 502);
  return NextResponse.json({ id: previous.id, object: 'email', status: previous.status, message_id: previous.message_id, subject: previous.subject, created_at: previous.created_at }, {
    status: previous.status === 'sent' ? 200 : 202,
    headers: { ...privateHeaders, ...(replayed ? { 'Idempotency-Replayed': 'true' } : {}) },
  });
}

function safeHeaders(value: string | null) {
  return jsonValue<Record<string, string>>(value, {});
}

function headerValue(headers: Record<string, string>, name: string) {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? '';
}

function stringList(value: string | null) {
  return jsonValue<string[]>(value, []).filter((item) => typeof item === 'string');
}

function forwardQuote(message: ThreadMessage, subject: string) {
  const body = (resolvePlainText(message.text_body, message.html_body) ?? '').trim();
  const content = body.length > 400_000 ? `${body.slice(0, 400_000)}\n\n[The original message was shortened.]` : body;
  const recipients = stringList(message.to_json);
  const cc = stringList(message.cc_json);
  return [
    '---------- Forwarded message ----------',
    `From: ${message.from_address}`,
    `Date: ${message.created_at}`,
    `Subject: ${subject}`,
    ...(recipients.length ? [`To: ${recipients.join(', ')}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    '',
    content,
  ].join('\n');
}

export async function POST(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('Request body must use application/json.', 415);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || !/^[\x21-\x7E]{1,256}$/.test(idempotencyKey)) return error('Provide a valid Idempotency-Key header.', 400);
  const parsed = await readJsonLimited(request, 520_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
  const body = parsed.value as Record<string, unknown>;
  const textValue = body.text;
  if (typeof textValue !== 'string' || textValue.length > 500_000 || textValue.includes('\u0000')) return error('text must be 500,000 characters or fewer.', 400);
  const bodyText = textValue.trim();
  const modeValue = body.mode ?? 'reply';
  if (typeof modeValue !== 'string' || !['reply', 'reply_all', 'forward'].includes(modeValue)) return error('mode must be reply, reply_all or forward.', 400);
  const mode = modeValue as InboxComposeMode;
  if (mode !== 'forward' && !bodyText) return error('text must contain a reply before sending.', 400);
  const providedTo = body.to === undefined ? null : parseInboxRecipientText(body.to);
  const providedCc = body.cc === undefined ? [] : parseInboxRecipientText(body.cc);
  const providedBcc = body.bcc === undefined ? [] : parseInboxRecipientText(body.bcc);
  if ((body.to !== undefined && !providedTo) || !providedCc || !providedBcc) return error('Recipients must be valid email addresses, with no more than 50 in each field.', 400);
  if (body.subject !== undefined && (typeof body.subject !== 'string' || body.subject.length > 998 || /[\r\n\u0000-\u001f\u007f]/.test(body.subject))) return error('subject must be 998 characters or fewer on one line.', 400);
  if (body.from !== undefined && !extractMailboxAddress(body.from)) return error('from must be a valid email address.', 400);
  const { id: threadId } = await context.params;
  const thread = await queryOne<{ id: string; api_key_id: string; workspace_id: string | null; subject: string; inbox_address: string | null; folder: string }>(
    `SELECT t.id,t.api_key_id,k.workspace_id,t.subject,t.inbox_address,t.folder
      FROM inbox_threads t LEFT JOIN api_keys k ON k.id=t.api_key_id WHERE t.id=?`, [threadId],
  );
  if (!thread) return error('Thread not found.', 404);

  if (thread.folder === 'trash' || thread.folder === 'spam') return error('Move this thread to the inbox before replying.', 409);
  const messages = await query<ThreadMessage>(`SELECT id,from_address,to_json,cc_json,subject,message_id,headers_json,text_body,html_body,'received' AS direction,received_at AS created_at
    FROM received_emails WHERE api_key_id=? AND (thread_id=? OR (thread_id IS NULL AND id=?))
    UNION ALL
    SELECT id,from_address,to_json,cc_json,subject,message_id,headers_json,text_body,html_body,'sent' AS direction,created_at
    FROM emails WHERE api_key_id=? AND thread_id=? AND status='sent'
    ORDER BY created_at ASC,id ASC`, [thread.api_key_id, thread.id, thread.id, thread.api_key_id, thread.id]);
  const lastReceived = [...messages.rows].reverse().find((message) => message.direction === 'received');
  if (!lastReceived) return error('This thread does not contain a received message to reply to.', 409);
  const recipientHeaders = safeHeaders(lastReceived.headers_json);
  const replyTo = headerValue(recipientHeaders, 'reply-to');
  const inboundTo = jsonValue<string[]>(lastReceived.to_json, []);
  const inboxAddress = extractMailboxAddress(thread.inbox_address || (inboundTo[0] ? mailbox(inboundTo[0]) : '')) ?? '';
  const defaults = replyAllRecipients({ from: lastReceived.from_address, replyTo, to: inboundTo, cc: stringList(lastReceived.cc_json), inboxAddress });
  if (!defaults) return error('The reply address is invalid.', 422);
  const fromAddress = body.from === undefined ? inboxAddress : extractMailboxAddress(body.from)!;
  const to = providedTo ?? (mode === 'forward' ? [] : defaults.to);
  const cc = body.cc === undefined && mode === 'reply_all' ? defaults.cc : providedCc ?? [];
  const bcc = providedBcc ?? [];
  if (!to.length) return error('Add at least one recipient before sending.', 422);
  if (to.length + cc.length + bcc.length > 50) return error('Use no more than 50 recipients across To, Cc and Bcc.', 422);
  const recipients = [...to, ...cc, ...bcc];
  const at = fromAddress.lastIndexOf('@');
  const fromDomain = at >= 0 ? fromAddress.slice(at + 1).toLowerCase() : '';
  const verifiedDomains = await query<{ domain: string }>('SELECT domain FROM domains WHERE verified_at IS NOT NULL');
  const verified = verifiedDomains.rows.map((row) => row.domain.toLowerCase()).filter(Boolean);
  if (!emailPattern.test(fromAddress) || !verified.some((domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`))) {
    return error('Add and verify a sending domain that matches this receiving address before replying.', 409);
  }
  const ownerKey = await queryOne<{ workspace_id: string }>('SELECT workspace_id FROM api_keys WHERE id=?', [thread.api_key_id]);
  const blocked = await findSuppressedAddresses(recipients, ownerKey?.workspace_id ?? DEFAULT_WORKSPACE_ID);
  if (blocked.length) return error('This recipient is on the block list. Remove the block before replying.', 409);

  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : composeSubject(mode, thread.subject);
  const text = mode === 'forward' ? `${bodyText ? `${bodyText}\n\n` : ''}${forwardQuote(lastReceived, thread.subject)}` : bodyText;
  if (text.length > 500_000) return error('The forwarded message and your note must be 500,000 characters or fewer.', 413);
  const latest = messages.rows.at(-1);
  const latestId = parseMessageIds(latest?.message_id).at(-1);
  const receivedId = parseMessageIds(lastReceived.message_id).at(-1);
  const inReplyTo = latestId ?? receivedId;
  const latestHeaders = safeHeaders(latest?.headers_json ?? null);
  const referenceIds = parseMessageIds(headerValue(latestHeaders, 'references'));
  if (inReplyTo) referenceIds.push(inReplyTo);
  const references = boundedMessageReferences(referenceIds);
  const headers = mode === 'forward' ? {} : {
    ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
    ...(references ? { References: references } : {}),
  };
  const legacyReply = body.mode === undefined && body.from === undefined && body.to === undefined && body.cc === undefined && body.bcc === undefined && body.subject === undefined;
  const requestHash = legacyReply ? replyRequestHash(thread.id, bodyText) : composeRequestHash(thread.id, { mode, from: fromAddress, to, cc, bcc, subject, text });
  await execute('DELETE FROM idempotency_keys WHERE expires_at<=?', [nowIso()]);
  const previous = await queryOne<Replay>(`SELECT i.request_hash,e.id,e.status,e.message_id,e.subject,e.created_at FROM idempotency_keys i
    JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [thread.api_key_id, idempotencyKey, nowIso()]);
  if (previous) {
    if (previous.request_hash !== requestHash) return error('This Idempotency-Key was already used for a different message.', 409);
    return replayResponse(previous);
  }
  const rateLimit = await consumeApiRequestLimit(thread.workspace_id ?? undefined);
  const withRateLimit = (response: Response) => withApiRateLimitHeaders(response, rateLimit);
  if (!rateLimit.allowed) return withRateLimit(error('The sending limit has been reached. Retry after the period in the retry-after header.', 429));

  const emailId = randomId('em');
  const createdAt = nowIso();
  try {
    await transaction([
      { sql: `INSERT INTO emails(id,api_key_id,from_address,to_json,cc_json,bcc_json,subject,status,created_at,headers_json,text_body,thread_id)
        VALUES(?,?,?,?,?,?,?,'processing',?,?,?,?)`, params: [emailId, thread.api_key_id, fromAddress, JSON.stringify(to), JSON.stringify(cc), JSON.stringify(bcc), subject, createdAt, JSON.stringify(headers), text, thread.id] },
      { sql: 'INSERT INTO idempotency_keys(api_key_id,idempotency_key,request_hash,email_id,expires_at,created_at) VALUES(?,?,?,?,?,?)', params: [thread.api_key_id, idempotencyKey, requestHash, emailId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), createdAt] },
    ]);
  } catch {
    const replay = await queryOne<Replay>(`SELECT i.request_hash,e.id,e.status,e.message_id,e.subject,e.created_at FROM idempotency_keys i
      JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [thread.api_key_id, idempotencyKey, nowIso()]);
    if (replay) {
      if (replay.request_hash !== requestHash) return withRateLimit(error('This Idempotency-Key was already used for a different reply.', 409));
      return withRateLimit(replayResponse(replay));
    }
    return withRateLimit(error('Could not save this reply.', 500));
  }

  let result: Awaited<ReturnType<typeof sendThroughSmtp>>;
  try {
    result = await sendThroughSmtp({ from: fromAddress, to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}), subject, text, ...(Object.keys(headers).length ? { headers } : {}) });
  } catch {
    try { await execute("UPDATE emails SET status='failed',error_message='Reply handoff failed.' WHERE id=?", [emailId]); } catch { /* Keep the durable processing state if status recording is unavailable. */ }
    try { await emitWebhookEvent(thread.api_key_id, 'email.failed', { email_id: emailId, error: 'Reply handoff failed.' }); } catch { /* The reply result is independent of event delivery. */ }
    return withRateLimit(error('The reply could not be handed off. Check the message details before trying again.', 502));
  }

  const sentAt = nowIso();
  try {
    await execute("UPDATE emails SET status='sent',provider_id=?,message_id=?,relay_message_id=? WHERE id=?", [result.response.slice(0, 500), result.messageId, relayMessageIdFromResponse(result.response), emailId]);
  } catch {
    // The receiving server accepted the message. Keep the idempotent record processing so a retry cannot send it twice.
    return withRateLimit(NextResponse.json({ id: emailId, object: 'email', status: 'processing', subject, created_at: createdAt }, { status: 202, headers: privateHeaders }));
  }

  try { await execute('UPDATE inbox_threads SET is_read=1,updated_at=? WHERE id=? AND api_key_id=?', [sentAt, thread.id, thread.api_key_id]); } catch { /* Sending succeeded; thread bookkeeping can be repaired later. */ }
  try { await recordEmailSentActivity(emailId, sentAt); } catch { /* Activity history must not turn an accepted message into a failed reply. */ }
  try { await emitWebhookEvent(thread.api_key_id, 'email.sent', { email_id: emailId, from: fromAddress, to, subject, message_id: result.messageId }); } catch { /* Event delivery is independent of the SMTP handoff. */ }
  try { await execute('DELETE FROM inbox_reply_drafts WHERE thread_id=? AND api_key_id=?', [thread.id, thread.api_key_id]); } catch { /* A sent message remains successful if draft cleanup needs repair. */ }
  return withRateLimit(NextResponse.json({ id: emailId, object: 'email', status: 'sent', message_id: result.messageId, subject, created_at: createdAt }, { headers: privateHeaders }));
}
