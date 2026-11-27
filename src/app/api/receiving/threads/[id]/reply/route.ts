import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { consumeApiRequestLimit, execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { findSuppressedAddresses } from '@/lib/suppressions';
import { sendThroughSmtp } from '@/lib/smtp';
import { relayMessageIdFromResponse } from '@/lib/ses-events';
import { emitWebhookEvent } from '@/lib/webhooks';
import { recordEmailSentActivity } from '@/lib/email-activity';
import { boundedMessageReferences, parseMessageIds, replyRequestHash } from '@/lib/inbox-threads';
import { withApiRateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
type Context = { params: Promise<{ id: string }> };
type ThreadMessage = { id: string; direction: string; from_address: string; to_json: string; subject: string; message_id: string | null; headers_json: string | null };
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

export async function POST(request: Request, context: Context) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('Request body must use application/json.', 415);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || !/^[\x21-\x7E]{1,256}$/.test(idempotencyKey)) return error('Provide a valid Idempotency-Key header.', 400);
  const parsed = await readJsonLimited(request, 520_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
  const textValue = (parsed.value as Record<string, unknown>).text;
  if (typeof textValue !== 'string' || !textValue.trim() || textValue.length > 500_000) return error('text must contain 1 to 500,000 characters.', 400);
  const bodyText = textValue.trim();
  const { id: threadId } = await context.params;
  const thread = await queryOne<{ id: string; api_key_id: string; subject: string; inbox_address: string | null; folder: string }>(
    'SELECT id,api_key_id,subject,inbox_address,folder FROM inbox_threads WHERE id=?', [threadId],
  );
  if (!thread) return error('Thread not found.', 404);

  const requestHash = replyRequestHash(thread.id, bodyText);
  await execute('DELETE FROM idempotency_keys WHERE expires_at<=?', [nowIso()]);
  const previous = await queryOne<Replay>(`SELECT i.request_hash,e.id,e.status,e.message_id,e.subject,e.created_at FROM idempotency_keys i
    JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [thread.api_key_id, idempotencyKey, nowIso()]);
  if (previous) {
    if (previous.request_hash !== requestHash) return error('This Idempotency-Key was already used for a different reply.', 409);
    return replayResponse(previous);
  }

  if (thread.folder === 'trash' || thread.folder === 'spam') return error('Move this thread to the inbox before replying.', 409);
  const messages = await query<ThreadMessage>(`SELECT id,from_address,to_json,subject,message_id,headers_json,'received' AS direction,received_at AS created_at
    FROM received_emails WHERE api_key_id=? AND (thread_id=? OR (thread_id IS NULL AND id=?))
    UNION ALL
    SELECT id,from_address,to_json,subject,message_id,headers_json,'sent' AS direction,created_at
    FROM emails WHERE api_key_id=? AND thread_id=? AND status='sent'
    ORDER BY created_at ASC,id ASC`, [thread.api_key_id, thread.id, thread.id, thread.api_key_id, thread.id]);
  const lastReceived = [...messages.rows].reverse().find((message) => message.direction === 'received');
  if (!lastReceived) return error('This thread does not contain a received message to reply to.', 409);
  const recipientHeaders = safeHeaders(lastReceived.headers_json);
  const replyTo = headerValue(recipientHeaders, 'reply-to');
  const recipient = mailbox(replyTo || lastReceived.from_address);
  if (recipient.length > 320 || /[\r\n]/.test(recipient) || !emailPattern.test(recipient)) return error('The reply address is invalid.', 422);

  const inboundTo = jsonValue<string[]>(lastReceived.to_json, []);
  const inboxAddress = (thread.inbox_address || (inboundTo[0] ? mailbox(inboundTo[0]) : '')).trim();
  const at = inboxAddress.lastIndexOf('@');
  const fromDomain = at >= 0 ? inboxAddress.slice(at + 1).toLowerCase() : '';
  const verifiedDomains = await query<{ domain: string }>('SELECT domain FROM domains WHERE verified_at IS NOT NULL');
  const verified = verifiedDomains.rows.map((row) => row.domain.toLowerCase()).filter(Boolean);
  if (!emailPattern.test(inboxAddress) || !verified.some((domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`))) {
    return error('Add and verify a sending domain that matches this inbox address before replying.', 409);
  }
  const blocked = await findSuppressedAddresses([recipient]);
  if (blocked.length) return error('This recipient is on the block list. Remove the block before replying.', 409);

  const subjectBase = thread.subject.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 900) || '(no subject)';
  const subject = /^re\s*:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;
  const latest = messages.rows.at(-1);
  const latestId = parseMessageIds(latest?.message_id).at(-1);
  const receivedId = parseMessageIds(lastReceived.message_id).at(-1);
  const inReplyTo = latestId ?? receivedId;
  const latestHeaders = safeHeaders(latest?.headers_json ?? null);
  const referenceIds = parseMessageIds(headerValue(latestHeaders, 'references'));
  if (inReplyTo) referenceIds.push(inReplyTo);
  const references = boundedMessageReferences(referenceIds);
  const headers = {
    ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
    ...(references ? { References: references } : {}),
  };
  const rateLimit = await consumeApiRequestLimit(thread.api_key_id);
  const withRateLimit = (response: Response) => withApiRateLimitHeaders(response, rateLimit);
  if (!rateLimit.allowed) return withRateLimit(error('The sending limit has been reached. Retry after the period in the retry-after header.', 429));

  const emailId = randomId('em');
  const createdAt = nowIso();
  try {
    await transaction([
      { sql: `INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,created_at,headers_json,text_body,thread_id)
        VALUES(?,?,?,?,?,'processing',?,?,?,?)`, params: [emailId, thread.api_key_id, inboxAddress, JSON.stringify([recipient]), subject, createdAt, JSON.stringify(headers), bodyText, thread.id] },
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
    result = await sendThroughSmtp({ from: inboxAddress, to: [recipient], subject, text: bodyText, ...(Object.keys(headers).length ? { headers } : {}) });
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
  try { await emitWebhookEvent(thread.api_key_id, 'email.sent', { email_id: emailId, from: inboxAddress, to: [recipient], subject, message_id: result.messageId }); } catch { /* Event delivery is independent of the SMTP handoff. */ }
  return withRateLimit(NextResponse.json({ id: emailId, object: 'email', status: 'sent', message_id: result.messageId, subject, created_at: createdAt }, { headers: privateHeaders }));
}
