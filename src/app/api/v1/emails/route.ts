import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { consumeSendLimit, execute, hashSecret, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { sendThroughSmtp, type OutboundAttachment } from '@/lib/smtp';
import { emitEmailSuppressed, findSuppressedAddresses } from '@/lib/suppressions';
import { trackedHtml } from '@/lib/tracking';
import { emitWebhookEvent } from '@/lib/webhooks';
import { findEmailTemplate, getPublishedTemplateContent, storedTemplateToContent } from '@/lib/email-templates';
import { relayMessageIdFromResponse } from '@/lib/ses-events';

export const runtime = 'nodejs';
export const maxDuration = 30;

type SendBody = {
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  reply_to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  headers?: unknown;
  tags?: unknown;
  attachments?: unknown;
  scheduled_at?: unknown;
  template_id?: unknown;
  template?: unknown;
  variables?: unknown;
};

type StoredEmail = {
  id: string;
  from_address: string;
  to_json: string;
  cc_json: string | null;
  bcc_json: string | null;
  reply_to: string | null;
  headers_json: string | null;
  tags_json: string | null;
  attachments_json: string | null;
  subject: string;
  status: string;
  error_message: string | null;
  provider_id: string | null;
  message_id: string | null;
  relay_message_id: string | null;
  scheduled_at: string | null;
  text_body: string | null;
  html_body: string | null;
  created_at: string;
};

type EmailTemplate = { id?: string; subject: string; html: string | null; text: string | null; from?: string | null; reply_to?: string | null; variables?: Array<{ key: string; type: 'string' | 'number'; fallback_value: string | number | null }> };
type EmailTag = { name: string; value: string };
type AttachmentMetadata = { filename: string; contentType?: string; contentId?: string };

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const forbiddenHeaders = new Set([
  'bcc', 'cc', 'content-length', 'content-transfer-encoding', 'content-type',
  'date', 'dkim-signature', 'from', 'message-id', 'mime-version', 'received',
  'reply-to', 'return-path', 'subject', 'to',
]);

function mailbox(value: string) {
  const match = /<([^<>]+)>$/.exec(value.trim());
  return (match?.[1] ?? value).trim().toLowerCase();
}

function responseError(error: string, status: number) {
  return NextResponse.json({ error: { message: error } }, { status });
}

function jsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function emailResponse(row: StoredEmail, includeContent = false) {
  return {
    id: row.id,
    object: 'email',
    from: row.from_address,
    to: jsonValue<string[]>(row.to_json, []),
    ...(row.cc_json ? { cc: jsonValue<string[]>(row.cc_json, []) } : {}),
    ...(row.bcc_json ? { bcc: jsonValue<string[]>(row.bcc_json, []) } : {}),
    ...(row.reply_to ? { reply_to: row.reply_to } : {}),
    ...(row.headers_json ? { headers: jsonValue<Record<string, string>>(row.headers_json, {}) } : {}),
    ...(row.tags_json ? { tags: jsonValue<EmailTag[]>(row.tags_json, []) } : {}),
    ...(row.attachments_json ? { attachments: jsonValue<AttachmentMetadata[]>(row.attachments_json, []) } : {}),
    subject: row.subject,
    ...(includeContent && row.text_body !== null ? { text: row.text_body } : {}),
    ...(includeContent && row.html_body !== null ? { html: row.html_body } : {}),
    status: row.status,
    ...(row.status === 'suppressed' && row.error_message ? { error: row.error_message } : {}),
    created_at: row.created_at,
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.provider_id ? { relayResponse: row.provider_id } : {}),
    ...(row.scheduled_at ? { scheduled_at: row.scheduled_at } : {}),
  };
}

const storedEmailColumns = 'id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,subject,status,error_message,provider_id,message_id,relay_message_id,scheduled_at,text_body,html_body,created_at';

async function getStoredEmail(id: string) {
  return await queryOne<StoredEmail>(`SELECT ${storedEmailColumns} FROM emails WHERE id=?`, [id]);
}

function parseAddresses(value: unknown, label: string, required: boolean): { ok: true; addresses: string[] } | { ok: false; error: string } {
  if (value === undefined && !required) return { ok: true, addresses: [] };
  const addresses = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (!addresses.length && required) return { ok: false, error: `${label} must contain at least one valid email address.` };
  const validMailbox = (address: unknown) => {
    if (typeof address !== 'string' || address.length > 320 || /[\r\n]/.test(address)) return false;
    const trimmed = address.trim();
    if (!trimmed) return false;
    if (/[<>]/.test(trimmed) && !/^.+<[^<>]+>$/.test(trimmed)) return false;
    return emailPattern.test(mailbox(trimmed));
  };
  if (addresses.length > 50 || !addresses.every(validMailbox)) {
    return { ok: false, error: `${label} must contain up to 50 valid email addresses.` };
  }
  const unique = [...new Map((addresses as string[]).map((address) => [mailbox(address), address.trim()])).values()];
  return { ok: true, addresses: unique };
}

function parseHeaders(value: unknown): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, headers: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'headers must be an object of string values.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) return { ok: false, error: 'headers may contain no more than 50 values.' };
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of entries) {
    if (!headerNamePattern.test(name) || forbiddenHeaders.has(name.toLowerCase())) return { ok: false, error: `The header name "${name}" is invalid or reserved.` };
    if (typeof headerValue !== 'string' || headerValue.length > 1000 || /[\r\n]/.test(headerValue)) return { ok: false, error: `The value for header "${name}" must be a single line of up to 1000 characters.` };
    headers[name] = headerValue;
  }
  return { ok: true, headers };
}

function parseTags(value: unknown): { ok: true; tags: EmailTag[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, tags: [] };
  if (!Array.isArray(value) || value.length > 50) return { ok: false, error: 'tags must be an array with no more than 50 entries.' };
  const tags: EmailTag[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'Each tag must contain a name and value.' };
    const { name, value: tagValue } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(name) || typeof tagValue !== 'string' || !tagValue.trim() || tagValue.length > 256 || /[\r\n]/.test(tagValue)) {
      return { ok: false, error: 'Each tag name must be 1 to 50 letters, numbers, underscores or hyphens, and each value must be 1 to 256 single-line characters.' };
    }
    if (names.has(name)) return { ok: false, error: `Tag "${name}" is duplicated.` };
    names.add(name);
    tags.push({ name, value: tagValue });
  }
  return { ok: true, tags };
}

function parseAttachments(value: unknown): { ok: true; attachments: OutboundAttachment[]; metadata: AttachmentMetadata[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, attachments: [], metadata: [] };
  if (!Array.isArray(value) || value.length > 10) return { ok: false, error: 'attachments must be an array with no more than 10 entries.' };
  const attachments: OutboundAttachment[] = [];
  const metadata: AttachmentMetadata[] = [];
  let totalBytes = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'Each attachment must include a filename and base64 content.' };
    const attachment = entry as { filename?: unknown; content?: unknown; content_type?: unknown; content_id?: unknown };
    const { filename, content, content_type: contentType, content_id: contentId } = attachment;
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 200 || /[\r\n/\\]/.test(filename)) return { ok: false, error: 'Attachment filenames must be 1 to 200 characters and cannot contain paths or line breaks.' };
    if (typeof content !== 'string' || !content || content.length > 900_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) return { ok: false, error: `Attachment "${filename}" must contain valid base64 content.` };
    const bytes = Buffer.from(content, 'base64');
    if (bytes.toString('base64') !== content) return { ok: false, error: `Attachment "${filename}" must contain canonical base64 content.` };
    totalBytes += bytes.byteLength;
    if (totalBytes > 650_000) return { ok: false, error: 'Attachments may not exceed 650 KB total in this deployment.' };
    if (contentType !== undefined && (typeof contentType !== 'string' || contentType.length > 200 || /[\r\n]/.test(contentType))) return { ok: false, error: `Attachment "${filename}" has an invalid content_type.` };
    if (contentId !== undefined && (typeof contentId !== 'string' || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(contentId) || contentId.length > 254)) return { ok: false, error: `Attachment "${filename}" has an invalid content_id.` };
    const clean = { filename: filename.trim(), content, ...(typeof contentType === 'string' ? { contentType } : {}), ...(typeof contentId === 'string' ? { contentId } : {}) };
    attachments.push(clean);
    metadata.push({ filename: clean.filename, ...(clean.contentType ? { contentType: clean.contentType } : {}), ...(clean.contentId ? { contentId: clean.contentId } : {}) });
  }
  return { ok: true, attachments, metadata };
}

function parseVariables(value: unknown): { ok: true; variables: Record<string, string | number | boolean> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, variables: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'variables must be an object of string, number or boolean values.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) return { ok: false, error: 'variables may contain no more than 100 values.' };
  const variables: Record<string, string | number | boolean> = {};
  for (const [name, variableValue] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || !['string', 'number', 'boolean'].includes(typeof variableValue) || (typeof variableValue === 'string' && variableValue.length > 10_000)) return { ok: false, error: `Variable "${name}" must have a simple name and a string, number or boolean value.` };
    variables[name] = variableValue as string | number | boolean;
  }
  return { ok: true, variables };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function renderTemplate(source: string | null, variables: Record<string, string | number | boolean>, escapeValues: boolean) {
  if (!source) return undefined;
  return source.replace(/\{\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}\}|\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}/g, (_match, tripleName: string | undefined, doubleName: string | undefined) => {
    const name = tripleName ?? doubleName;
    if (!name) return '';
    const value = variables[name];
    if (value === undefined) return '';
    const stringValue = String(value);
    return escapeValues && !tripleName ? escapeHtml(stringValue) : stringValue;
  });
}

async function __emailgo_GET_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return responseError('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return responseError('This API key has sending-only access.', 403);
  const url = new URL(request.url);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return responseError('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  const before = url.searchParams.get('before');
  if (after !== null && before !== null) return responseError('Use either after or before, not both.', 400);
  let rows: StoredEmail[];
  if (after !== null) {
    if (!after) return responseError('after must be a non-empty email ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM emails WHERE id = ? AND api_key_id = ?', [after, apiKey.id]);
    if (!cursor) return responseError('after must be an email ID available to this API key.', 400);
    rows = (await query<StoredEmail>(`SELECT ${storedEmailColumns} FROM emails
      WHERE api_key_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [apiKey.id, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else if (before !== null) {
    if (!before) return responseError('before must be a non-empty email ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM emails WHERE id = ? AND api_key_id = ?', [before, apiKey.id]);
    if (!cursor) return responseError('before must be an email ID available to this API key.', 400);
    rows = (await query<StoredEmail>(`SELECT ${storedEmailColumns} FROM emails
      WHERE api_key_id = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC,id ASC LIMIT ?`, [apiKey.id, cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).reverse();
    return NextResponse.json({ object: 'list', data: data.map((row) => emailResponse(row)), has_more: hasMore, ...(hasMore ? { next_before: data[data.length - 1]?.id } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } else {
    rows = (await query<StoredEmail>(`SELECT ${storedEmailColumns} FROM emails WHERE api_key_id = ? ORDER BY created_at DESC,id DESC LIMIT ?`, [apiKey.id, limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map((row) => emailResponse(row)), has_more: hasMore, ...(hasMore ? { next_after: data[data.length - 1]?.id } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function sendEmailRequest(request: Request, options: { countRateLimit?: boolean } = {}) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return responseError('Invalid or revoked API key.', 401);
  if (options.countRateLimit !== false && !await consumeSendLimit(apiKey.id)) return responseError('Rate limit exceeded. Try again in the next minute.', 429);
  const parsed = await readJsonLimited(request, 1_000_000);
  if (!parsed.ok) return responseError(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return responseError('Request body must be a JSON object.', 400);
  const body = parsed.value as SendBody;

  if (body.from !== undefined && typeof body.from !== 'string') return responseError('from must be a string.', 400);
  const suppliedFrom = typeof body.from === 'string' ? body.from.trim() : null;
  const parsedTo = parseAddresses(body.to, 'to', true);
  const parsedCc = parseAddresses(body.cc, 'cc', false);
  const parsedBcc = parseAddresses(body.bcc, 'bcc', false);
  const parsedHeaders = parseHeaders(body.headers);
  const parsedTags = parseTags(body.tags);
  const parsedAttachments = parseAttachments(body.attachments);
  if (body.template !== undefined && body.template_id !== undefined) return responseError('Use either template or template_id, not both.', 400);
  const templateRequest = body.template;
  if (templateRequest !== undefined && (!templateRequest || typeof templateRequest !== 'object' || Array.isArray(templateRequest))) return responseError('template must be an object containing an id and optional variables.', 400);
  const templateObject = templateRequest as { id?: unknown; variables?: unknown } | undefined;
  if (templateObject?.variables !== undefined && body.variables !== undefined) return responseError('Provide template variables inside template.variables only.', 400);
  const parsedVariables = parseVariables(templateObject?.variables !== undefined ? templateObject.variables : body.variables);
  if (!parsedTo.ok) return responseError(parsedTo.error, 400);
  if (!parsedCc.ok) return responseError(parsedCc.error, 400);
  if (!parsedBcc.ok) return responseError(parsedBcc.error, 400);
  if (!parsedHeaders.ok) return responseError(parsedHeaders.error, 400);
  if (!parsedTags.ok) return responseError(parsedTags.error, 400);
  if (!parsedAttachments.ok) return responseError(parsedAttachments.error, 400);
  if (!parsedVariables.ok) return responseError(parsedVariables.error, 400);
  let to = parsedTo.addresses;
  let cc = parsedCc.addresses;
  let bcc = parsedBcc.addresses;
  const recipients = [...new Set([...to, ...cc, ...bcc].map(mailbox))];
  if (recipients.length > 50) return responseError('to, cc and bcc may contain no more than 50 unique recipients combined.', 400);

  let template: EmailTemplate | undefined;
  if (templateObject) {
    if (typeof templateObject.id !== 'string' || !templateObject.id.trim() || templateObject.id.length > 120) return responseError('template.id must be a valid template ID or alias.', 400);
    if (body.text !== undefined || body.html !== undefined) return responseError('Use either template or text/html content, not both.', 400);
    if (Object.keys(parsedVariables.variables).length > 50 || Object.values(parsedVariables.variables).some((value) => typeof value === 'boolean')) return responseError('Template variables must contain no more than 50 string or number values.', 400);
    const stored = await findEmailTemplate(templateObject.id.trim());
    if (!stored) return responseError('The requested email template was not found.', 404);
    const published = await getPublishedTemplateContent(stored);
    if (!published) return responseError('The requested email template is not published.', 422);
    const templateVariables = new Map((published.variables ?? []).map((variable) => [variable.key, variable]));
    const variableNames = new Set<string>();
    for (const source of [published.subject, published.html, published.text ?? '']) {
      for (const match of source.matchAll(/\{\{\{?\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}\}?/g)) variableNames.add(match[1]);
    }
    for (const name of variableNames) {
      if (parsedVariables.variables[name] !== undefined) continue;
      const fallback = templateVariables.get(name)?.fallback_value;
      if (fallback === null || fallback === undefined) return responseError(`Template variable "${name}" must be provided.`, 422);
      parsedVariables.variables[name] = fallback;
    }
    template = { subject: published.subject, html: published.html, text: published.text, from: published.from, reply_to: published.reply_to, variables: published.variables };
  } else if (body.template_id !== undefined) {
    if (typeof body.template_id !== 'string' || !body.template_id.trim() || body.template_id.length > 100) return responseError('template_id must be a valid template ID.', 400);
    if (body.text !== undefined || body.html !== undefined) return responseError('Use either template_id or text/html content, not both.', 400);
    template = await queryOne<EmailTemplate>('SELECT id,subject,html,text FROM email_templates WHERE id=?', [body.template_id.trim()]);
    if (!template) return responseError('The requested email template was not found.', 404);
  } else if (body.variables !== undefined) {
    return responseError('variables can only be used with template_id.', 400);
  }

  const from = suppliedFrom ?? template?.from ?? '';
  const sender = mailbox(from);

  let scheduledAt: string | null = null;
  if (body.scheduled_at !== undefined) {
    if (!process.env.CRON_SECRET) return responseError('Scheduled sending is not configured on this Emailgo deployment.', 503);
    if (typeof body.scheduled_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.scheduled_at) || !Number.isFinite(Date.parse(body.scheduled_at))) return responseError('scheduled_at must be an ISO 8601 timestamp.', 400);
    const scheduleTime = Date.parse(body.scheduled_at);
    if (scheduleTime <= Date.now()) return responseError('scheduled_at must be in the future.', 400);
    if (scheduleTime > Date.now() + 30 * 24 * 60 * 60 * 1000) return responseError('scheduled_at cannot be more than 30 days in the future.', 400);
    scheduledAt = new Date(scheduleTime).toISOString();
  }

  const suppliedSubject = body.subject === undefined ? '' : typeof body.subject === 'string' ? body.subject : null;
  if (suppliedSubject === null) return responseError('subject must be a string.', 400);
  const subjectSource = body.subject === undefined ? template?.subject ?? '' : suppliedSubject;
  const subject = (template ? renderTemplate(subjectSource, parsedVariables.variables, false) ?? '' : subjectSource).trim();
  const replyTo = body.reply_to === undefined ? template?.reply_to ?? '' : typeof body.reply_to === 'string' ? body.reply_to.trim() : null;
  if (replyTo === null || (replyTo && (replyTo.length > 320 || /[\r\n]/.test(replyTo) || !emailPattern.test(mailbox(replyTo))))) return responseError('reply_to must be a valid email address.', 400);
  if (!from || from.length > 320 || /[\r\n]/.test(from) || !emailPattern.test(sender)) return responseError('A valid from email address is required.', 400);
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) return responseError('subject must be 1 to 998 characters and cannot contain line breaks.', 400);

  const rawText = typeof body.text === 'string' ? body.text : undefined;
  const rawHtml = typeof body.html === 'string' ? body.html : undefined;
  const text = template ? renderTemplate(template.text, parsedVariables.variables, false) : rawText;
  const html = template ? renderTemplate(template.html, parsedVariables.variables, true) : rawHtml;
  if (text === undefined && html === undefined) return responseError('Provide text, html, or a template_id containing text or html.', 400);
  if ((text?.length ?? 0) > 500_000 || (html?.length ?? 0) > 500_000) return responseError('Email content exceeds the 500 KB limit.', 413);

  const senderDomain = sender.slice(sender.lastIndexOf('@') + 1).toLowerCase();
  const verifiedDomains = (await query<{ id: string; domain: string; open_tracking: number; click_tracking: number }>('SELECT id,domain,open_tracking,click_tracking FROM domains WHERE verified_at IS NOT NULL')).rows;
  const senderDomainConfig = verifiedDomains
    .filter(({ domain }) => senderDomain === domain.toLowerCase() || senderDomain.endsWith(`.${domain.toLowerCase()}`))
    .sort((left, right) => right.domain.length - left.domain.length)[0];
  if (!senderDomainConfig) return responseError('The sender domain must be verified in your Emailgo dashboard.', 403);
  if (apiKey.permission === 'sending_access' && apiKey.domainId !== senderDomainConfig.id) return responseError('This sending-only API key is restricted to a different sender domain.', 403);
  const tracking = { openTracking: Boolean(senderDomainConfig.open_tracking), clickTracking: Boolean(senderDomainConfig.click_tracking) };
  if ((tracking.openTracking || tracking.clickTracking) && (!process.env.EMAILGO_PUBLIC_URL || !process.env.EMAILGO_TRACKING_SECRET)) return responseError('Tracking is enabled for this sender domain but its public URL or signing secret is not configured.', 503);

  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null && !/^[\x21-\x7E]{1,256}$/.test(idempotencyKey)) return responseError('Idempotency-Key must be 1 to 256 visible ASCII characters.', 400);
  const requestHash = hashSecret(JSON.stringify({
    from, to, cc, bcc, replyTo: replyTo || null, subject, text: text ?? null, html: html ?? null,
    headers: parsedHeaders.headers, tags: parsedTags.tags, scheduledAt,
    attachments: parsedAttachments.attachments,
  }));
  if (idempotencyKey) {
    await execute('DELETE FROM idempotency_keys WHERE expires_at <= ?', [nowIso()]);
    const replay = await queryOne<StoredEmail & { request_hash: string }>(`SELECT i.request_hash,e.${storedEmailColumns.replaceAll(',', ',e.')}
      FROM idempotency_keys i JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [apiKey.id, idempotencyKey, nowIso()]);
    if (replay) {
      if (replay.request_hash !== requestHash) return responseError('This Idempotency-Key was already used with a different request.', 409);
      const headers = { 'Idempotency-Replayed': 'true' };
      if (replay.status === 'failed') return NextResponse.json({ error: { message: 'Email delivery failed. Check the message details in your Emailgo dashboard.' }, id: replay.id }, { status: 502, headers });
      return NextResponse.json(emailResponse(replay), { status: ['queued', 'scheduled', 'processing'].includes(replay.status) ? 202 : 200, headers });
    }
  }

  const suppressedRecipients = await findSuppressedAddresses(recipients);
  const suppressedEmails = new Set(suppressedRecipients.map((row) => row.normalized_email));
  to = to.filter((address) => !suppressedEmails.has(mailbox(address)));
  cc = cc.filter((address) => !suppressedEmails.has(mailbox(address)));
  bcc = bcc.filter((address) => !suppressedEmails.has(mailbox(address)));
  const allRecipientsSuppressed = to.length + cc.length + bcc.length === 0;

  const id = randomId('em');
  const createdAt = nowIso();
  let trackedBody: string | undefined;
  if (tracking.openTracking || tracking.clickTracking) {
    try {
      const rendered = trackedHtml(id, html ?? '', tracking);
      if (!scheduledAt && html !== undefined) trackedBody = rendered;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Tracking configuration is invalid.';
      return responseError(message, 503);
    }
  }
  const metadata = JSON.stringify(parsedAttachments.metadata);
  const insertSql = `INSERT INTO emails(id,api_key_id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,subject,status,error_message,text_body,html_body,attachment_payload_json,scheduled_at,track_opens,track_clicks,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const insertParams = [
    id, apiKey.id, from, JSON.stringify(to), cc.length ? JSON.stringify(cc) : null,
    bcc.length ? JSON.stringify(bcc) : null, replyTo || null,
    Object.keys(parsedHeaders.headers).length ? JSON.stringify(parsedHeaders.headers) : null,
    parsedTags.tags.length ? JSON.stringify(parsedTags.tags) : null,
    parsedAttachments.metadata.length ? metadata : null, subject,
    allRecipientsSuppressed ? 'suppressed' : scheduledAt ? 'scheduled' : 'queued',
    allRecipientsSuppressed ? 'Every recipient was skipped because the address is on the Emailgo suppression list.' : null,
    text ?? null, html ?? null,
    scheduledAt && parsedAttachments.attachments.length ? JSON.stringify(parsedAttachments.attachments) : null,
    allRecipientsSuppressed ? null : scheduledAt, tracking.openTracking ? 1 : 0, tracking.clickTracking ? 1 : 0, createdAt,
  ];
  if (idempotencyKey) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      await transaction([
        { sql: insertSql, params: insertParams },
        { sql: `INSERT INTO idempotency_keys(api_key_id,idempotency_key,request_hash,email_id,expires_at,created_at)
          VALUES(?,?,?,?,?,?)`, params: [apiKey.id, idempotencyKey, requestHash, id, expiresAt, createdAt] },
      ]);
    } catch (error) {
      const replay = await queryOne<StoredEmail & { request_hash: string }>(`SELECT i.request_hash,e.${storedEmailColumns.replaceAll(',', ',e.')}
        FROM idempotency_keys i JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [apiKey.id, idempotencyKey, nowIso()]);
      if (!replay) throw error;
      if (replay.request_hash !== requestHash) return responseError('This Idempotency-Key was already used with a different request.', 409);
      return NextResponse.json(emailResponse(replay), { status: ['queued', 'scheduled', 'processing'].includes(replay.status) ? 202 : replay.status === 'failed' ? 502 : 200, headers: { 'Idempotency-Replayed': 'true' } });
    }
  } else {
    await execute(insertSql, insertParams);
  }

  if (suppressedRecipients.length) {
    await Promise.all(suppressedRecipients.map((row) => emitEmailSuppressed(apiKey.id, id, from, row.email, subject)));
  }

  if (allRecipientsSuppressed) {
    const suppressedEmail = await getStoredEmail(id);
    return suppressedEmail ? NextResponse.json(emailResponse(suppressedEmail)) : responseError('The suppressed email could not be read.', 500);
  }

  if (scheduledAt) {
    const scheduledEmail = await getStoredEmail(id);
    if (!scheduledEmail) return responseError('The scheduled email could not be read.', 500);
    return NextResponse.json(emailResponse(scheduledEmail), { status: 202 });
  }

  try {
    const smtpResult = await sendThroughSmtp({
      from, to, cc, bcc, subject,
      ...(replyTo ? { replyTo } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(trackedBody !== undefined ? { html: trackedBody } : {}),
      ...(Object.keys(parsedHeaders.headers).length ? { headers: parsedHeaders.headers } : {}),
      ...(parsedAttachments.attachments.length ? { attachments: parsedAttachments.attachments } : {}),
    });
    await execute('UPDATE emails SET status = ?, provider_id = ?, message_id = ?, relay_message_id = ? WHERE id = ?', ['sent', smtpResult.response.slice(0, 500), smtpResult.messageId, relayMessageIdFromResponse(smtpResult.response), id]);
    await emitWebhookEvent(apiKey.id, 'email.sent', { email_id: id, from, to, subject, message_id: smtpResult.messageId });
    const storedEmail = await getStoredEmail(id);
    if (!storedEmail) throw new Error('The sent email record could not be read.');
    return NextResponse.json(emailResponse(storedEmail), { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'SMTP delivery failed.';
    await execute('UPDATE emails SET status = ?, error_message = ? WHERE id = ?', ['failed', message, id]);
    await emitWebhookEvent(apiKey.id, 'email.failed', { email_id: id, error: 'SMTP handoff failed.' });
    return NextResponse.json({ error: { message: 'Email delivery failed. Check the message details in your Emailgo dashboard.' }, id }, { status: 502 });
  }
}

async function __emailgo_POST_handler(request: Request) {
  return sendEmailRequest(request);
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
