import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { readTextLimited } from '@/lib/request-json';
import { webhookEventStatements } from '@/lib/webhooks';
import { findReferencedThread, replyReferences } from '@/lib/inbox-threads';

export const runtime = 'nodejs';
export const maxDuration = 30;
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const MAX_ATTACHMENT_BYTES = 3_000_000;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

function addressList(value: unknown, field: string, required = false): { ok: true; values: string[] } | { ok: false; error: string } {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (required && !values.length) return { ok: false, error: `${field} must contain at least one recipient.` };
  if (values.length > 100 || !values.every((entry) => typeof entry === 'string' && entry.length <= 320 && !/[\r\n]/.test(entry) && emailPattern.test(/<([^<>]+)>$/.exec(entry)?.[1] ?? entry))) return { ok: false, error: `${field} must contain up to 100 valid addresses.` };
  return { ok: true, values: [...new Set((values as string[]).map((entry) => entry.trim()))] };
}

function signatureMatches(secret: string, timestamp: string, body: string, supplied: string) {
  const candidate = supplied.startsWith('sha256=') ? supplied.slice(7) : supplied;
  let signature: Buffer;
  try { signature = Buffer.from(candidate, 'base64url'); } catch { return false; }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return signature.length === expected.length && timingSafeEqual(signature, expected);
}

export async function POST(request: Request) {
  const secret = process.env.EMAILGO_INBOUND_SECRET;
  if (!secret || secret.length < 32) return error('Inbound receiving is not configured.', 503);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error('Inbound payload must use application/json.', 415);
  const timestamp = request.headers.get('x-send-thanks-timestamp') ?? request.headers.get('x-emailgo-timestamp') ?? '';
  const signature = request.headers.get('x-send-thanks-signature') ?? request.headers.get('x-emailgo-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return error('Inbound signature timestamp is missing or outside the five-minute window.', 401);
  const text = await readTextLimited(request, 5_500_000);
  if (!text.ok) return error(text.error, text.status);
  if (!signatureMatches(secret, timestamp, text.text, signature)) return error('Inbound signature is invalid.', 401);
  let decoded: unknown;
  try { decoded = JSON.parse(text.text); } catch { return error('Inbound payload must be valid JSON.', 400); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return error('Inbound payload must be a JSON object.', 400);
  const envelope = decoded as Record<string, unknown>;
  if (envelope.type !== undefined && envelope.type !== 'email.received') return error('Only email.received events are accepted.', 400);
  const payload = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : envelope.email && typeof envelope.email === 'object' && !Array.isArray(envelope.email)
      ? envelope.email as Record<string, unknown>
      : envelope;
  const eventId = request.headers.get('x-send-thanks-event-id') ?? request.headers.get('x-emailgo-event-id') ?? (typeof envelope.event_id === 'string' ? envelope.event_id : typeof envelope.id === 'string' ? envelope.id : '');
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(eventId)) return error('Provide a valid provider event ID.', 400);
  const from = typeof payload.from === 'string' ? payload.from.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : typeof payload.messageId === 'string' ? payload.messageId : null;
  if (!from || from.length > 320 || /[\r\n]/.test(from)) return error('from must be a single-line address of up to 320 characters.', 400);
  if (subject.length > 998 || /[\r\n]/.test(subject)) return error('subject must be a single-line value of up to 998 characters.', 400);
  if (messageId !== null && (messageId.length > 998 || /[\r\n]/.test(messageId))) return error('message_id must be a single-line value of up to 998 characters.', 400);
  const to = addressList(payload.to, 'to', true);
  const cc = addressList(payload.cc, 'cc');
  const bcc = addressList(payload.bcc, 'bcc');
  if (!to.ok) return error(to.error, 400);
  if (!cc.ok) return error(cc.error, 400);
  if (!bcc.ok) return error(bcc.error, 400);
  const bodyText = payload.text === undefined || payload.text === null ? null : typeof payload.text === 'string' ? payload.text : undefined;
  const bodyHtml = payload.html === undefined || payload.html === null ? null : typeof payload.html === 'string' ? payload.html : undefined;
  if (bodyText === undefined || bodyHtml === undefined || bodyText === null && bodyHtml === null) return error('Provide text or html content as strings.', 400);
  if ((bodyText?.length ?? 0) > 1_000_000 || (bodyHtml?.length ?? 0) > 1_000_000) return error('Email content exceeds the 1 MB limit.', 413);
  const headerValue = payload.headers === undefined ? {} : payload.headers;
  if (!headerValue || typeof headerValue !== 'object' || Array.isArray(headerValue)) return error('headers must be an object.', 400);
  const headers = Object.entries(headerValue as Record<string, unknown>);
  if (headers.length > 50 || headers.some(([name, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/.test(name) || typeof value !== 'string' || value.length > 5000 || /[\r\n]/.test(value))) return error('headers must contain up to 50 single-line string values.', 400);
  const attachmentValue = payload.attachments === undefined ? [] : payload.attachments;
  if (!Array.isArray(attachmentValue) || attachmentValue.length > 10) return error('attachments must contain up to 10 items.', 400);
  const attachments: Array<{ id: string; filename: string; contentType: string; contentDisposition: string | null; contentId: string | null; byteLength: number; contentBase64: string }> = [];
  let attachmentBytes = 0;
  for (const entry of attachmentValue) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return error('Each attachment must include filename and base64 content.', 400);
    const item = entry as Record<string, unknown>;
    const filename = typeof item.filename === 'string' ? item.filename.trim() : '';
    const contentType = typeof item.content_type === 'string' ? item.content_type : 'application/octet-stream';
    const contentBase64 = typeof item.content_base64 === 'string' ? item.content_base64 : typeof item.content === 'string' ? item.content : '';
    if (!filename || filename.length > 200 || /[\r\n/\\]/.test(filename) || contentType.length > 200 || /[\r\n]/.test(contentType)) return error('Attachment filename or content type is invalid.', 400);
    if (!contentBase64 || contentBase64.length > 4_100_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) return error(`Attachment "${filename}" must contain canonical base64 data.`, 400);
    const bytes = Buffer.from(contentBase64, 'base64');
    if (bytes.toString('base64') !== contentBase64) return error(`Attachment "${filename}" must contain canonical base64 data.`, 400);
    attachmentBytes += bytes.byteLength;
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) return error('Received attachments may not exceed 3 MB total.', 413);
    const contentDisposition = typeof item.content_disposition === 'string' ? item.content_disposition : null;
    const contentId = typeof item.content_id === 'string' ? item.content_id : null;
    if (contentDisposition !== null && (contentDisposition.length > 100 || /[\r\n]/.test(contentDisposition))) return error('content_disposition is invalid.', 400);
    if (contentId !== null && (contentId.length > 254 || /[\r\n]/.test(contentId))) return error('content_id is invalid.', 400);
    attachments.push({ id: randomId('att'), filename, contentType, contentDisposition, contentId, byteLength: bytes.byteLength, contentBase64 });
  }
  const receivingApiKeyId = process.env.EMAILGO_RECEIVING_API_KEY_ID;
  if (!receivingApiKeyId) return error('Set EMAILGO_RECEIVING_API_KEY_ID to an active full-access Email, thanks key ID.', 503);
  const ownerKey = await queryOne<{ id: string }>("SELECT id FROM api_keys WHERE id=? AND permission='full_access' AND revoked_at IS NULL", [receivingApiKeyId]);
  if (!ownerKey) return error('EMAILGO_RECEIVING_API_KEY_ID must reference an active full-access Email, thanks key.', 503);
  const existing = await queryOne<{
    id: string; api_key_id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null;
    subject: string; message_id: string | null;
  }>('SELECT id,api_key_id,from_address,to_json,cc_json,bcc_json,subject,message_id FROM received_emails WHERE provider_event_id=?', [eventId]);
  const stableEventId = `email.received:${createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`;
  if (existing) {
    if (existing.api_key_id !== ownerKey.id) return NextResponse.json({ id: existing.id, object: 'received_email', duplicate: true }, { headers: privateHeaders });
    try {
      const storedAttachments = await query<{ id: string; filename: string; content_type: string; content_disposition: string | null; content_id: string | null; byte_length: number }>(
        'SELECT id,filename,content_type,content_disposition,content_id,byte_length FROM received_email_attachments WHERE received_email_id=? ORDER BY id',
        [existing.id],
      );
      const deliveryStatements = await webhookEventStatements(ownerKey.id, [{
        type: 'email.received',
        data: {
          email_id: existing.id, from: existing.from_address,
          to: JSON.parse(existing.to_json) as string[],
          cc: existing.cc_json ? JSON.parse(existing.cc_json) as string[] : [],
          bcc: existing.bcc_json ? JSON.parse(existing.bcc_json) as string[] : [],
          subject: existing.subject, message_id: existing.message_id,
          attachments: storedAttachments.rows.map(({ byte_length, ...attachment }) => ({ ...attachment, size: byte_length })),
        },
        stableEventId,
      }]);
      await transaction(deliveryStatements);
    } catch {
      return error('Could not recover the received email notification.', 500);
    }
    return NextResponse.json({ id: existing.id, object: 'received_email', duplicate: true }, { headers: privateHeaders });
  }
  const id = randomId('rx');
  const timestampNow = nowIso();
  const receivedAt = typeof payload.created_at === 'string' && Number.isFinite(Date.parse(payload.created_at)) ? new Date(payload.created_at).toISOString() : timestampNow;
  const storedHeaders = Object.fromEntries(headers as Array<[string, string]>);
  const parentThread = await findReferencedThread(ownerKey.id, replyReferences(storedHeaders));
  const threadId = parentThread?.id ?? id;
  const threadSubject = parentThread?.subject || subject;
  const firstTo = to.values[0];
  const inboxAddress = (/<([^<>]+)>$/.exec(firstTo)?.[1] ?? firstTo).trim();
  const statements: Array<{ sql: string; params: readonly unknown[] }> = [{
    sql: `INSERT INTO inbox_threads(id,api_key_id,subject,inbox_address,folder,is_read,labels_json,created_at,updated_at)
      VALUES(?,?,?,?,'inbox',0,'[]',?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,is_read=0,
      inbox_address=COALESCE(inbox_threads.inbox_address,excluded.inbox_address),
      folder=CASE WHEN inbox_threads.folder IN ('archive','sent') THEN 'inbox' ELSE inbox_threads.folder END`,
    params: [threadId, ownerKey.id, threadSubject, inboxAddress, timestampNow, receivedAt],
  }];
  if (parentThread?.source === 'received') statements.push({
    sql: 'UPDATE received_emails SET thread_id=? WHERE id=? AND api_key_id=? AND (thread_id IS NULL OR thread_id=?)',
    params: [threadId, parentThread.sourceId, ownerKey.id, threadId],
  });
  if (parentThread?.source === 'sent') statements.push({
    sql: 'UPDATE emails SET thread_id=? WHERE id=? AND api_key_id=? AND (thread_id IS NULL OR thread_id=?)',
    params: [threadId, parentThread.sourceId, ownerKey.id, threadId],
  });
  statements.push({
    sql: 'INSERT INTO received_emails(id,provider_event_id,api_key_id,message_id,from_address,to_json,cc_json,bcc_json,subject,headers_json,text_body,html_body,received_at,created_at,thread_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    params: [id, eventId, ownerKey.id, messageId, from, JSON.stringify(to.values), cc.values.length ? JSON.stringify(cc.values) : null, bcc.values.length ? JSON.stringify(bcc.values) : null, subject, headers.length ? JSON.stringify(storedHeaders) : null, bodyText, bodyHtml, receivedAt, timestampNow, threadId],
  });
  for (const attachment of attachments) statements.push({
    sql: 'INSERT INTO received_email_attachments(id,received_email_id,filename,content_type,content_disposition,content_id,byte_length,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    params: [attachment.id, id, attachment.filename, attachment.contentType, attachment.contentDisposition, attachment.contentId, attachment.byteLength, attachment.contentBase64, timestampNow],
  });
  try {
    const deliveryStatements = await webhookEventStatements(ownerKey.id, [{
      type: 'email.received',
      data: {
        email_id: id, from, to: to.values, cc: cc.values, bcc: bcc.values, subject, message_id: messageId,
        attachments: attachments.map(({ id: attachmentId, filename, contentType: type, contentDisposition, contentId, byteLength }) => ({ id: attachmentId, filename, content_type: type, content_disposition: contentDisposition, content_id: contentId, size: byteLength })),
      },
      stableEventId,
    }]);
    await transaction([...statements, ...deliveryStatements]);
  }
  catch {
    const duplicate = await queryOne<{ id: string; api_key_id: string }>('SELECT id,api_key_id FROM received_emails WHERE provider_event_id=?', [eventId]);
    if (duplicate?.api_key_id === ownerKey.id) return NextResponse.json({ id: duplicate.id, object: 'received_email', duplicate: true }, { headers: privateHeaders });
    if (duplicate) return error('Provider event ID is already used.', 409);
    return error('Could not persist the received email.', 500);
  }
  return NextResponse.json({ id, object: 'received_email', duplicate: false, thread_id: threadId, received_at: receivedAt }, { status: 201, headers: privateHeaders });
}
