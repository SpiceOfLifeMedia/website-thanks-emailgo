import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { sanitizeCustomerCopy } from '@/lib/customer-copy';
import { emailHtmlToPlainText } from '@/lib/email-share-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EmailDetail = {
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
  text_body: string | null;
  html_body: string | null;
  status: string;
  error_message: string | null;
  provider_id: string | null;
  message_id: string | null;
  scheduled_at: string | null;
  created_at: string;
};

function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  const { id } = await context.params;
  const row = await queryOne<EmailDetail>(`SELECT id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,subject,text_body,html_body,status,error_message,provider_id,message_id,scheduled_at,created_at
    FROM emails WHERE id=?`, [id]);
  if (!row) return NextResponse.json({ error: 'Email not found.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  const deliveryRows = (await query<{ event_type: string; created_at: string; detail: string | null }>(`SELECT event_type,MIN(created_at) AS created_at,MAX(detail) AS detail FROM delivery_events
    WHERE email_id=? GROUP BY event_type ORDER BY MIN(created_at),event_type`, [id])).rows;
  const eventLabels: Record<string, { status: string; note: string }> = {
    deferred: { status: 'Deferred', note: 'The delivery attempt was delayed.' },
    delivered: { status: 'Delivered', note: 'Confirmed by a signed delivery notification.' },
    bounced: { status: 'Bounced', note: 'The recipient address could not receive this email.' },
    complained: { status: 'Complained', note: 'The recipient marked this email as unwanted.' },
  };
  const events: Array<{ status: string; at: string; note: string }> = [{ status: 'Queued', at: row.created_at, note: 'Accepted by the API.' }];
  if (row.status === 'failed') events.push({ status: 'Failed', at: row.created_at, note: 'The handoff could not be completed.' });
  else if (['sent', 'deferred', 'delivered', 'bounced', 'complained'].includes(row.status)) events.push({ status: 'Sent', at: row.created_at, note: 'Handed off for delivery.' });
  for (const event of deliveryRows) {
    const label = eventLabels[event.event_type];
    if (label) events.push({ status: label.status, at: event.created_at, note: event.detail ? sanitizeCustomerCopy(event.detail) : label.note });
  }
  const fromMatch = /^(.*?)\s*<([^<>]+)>$/.exec(row.from_address);
  let hasAttachments = false;
  try { const value: unknown = JSON.parse(row.attachments_json ?? '[]'); hasAttachments = Array.isArray(value) && value.length > 0; } catch { /* Malformed metadata is treated as absent. */ }
  return NextResponse.json({
    id: row.id,
    from: row.from_address,
    to: jsonValue<string[]>(row.to_json, []),
    cc: jsonValue<string[]>(row.cc_json, []),
    bcc: jsonValue<string[]>(row.bcc_json, []),
    reply_to: row.reply_to,
    headers: jsonValue<Record<string, string>>(row.headers_json, {}),
    tags: jsonValue<Array<{ name: string; value: string }>>(row.tags_json, []),
    attachments: jsonValue<Array<{ filename: string; contentType?: string; contentId?: string }>>(row.attachments_json, []),
    subject: row.subject,
    text: row.text_body ?? (row.html_body ? emailHtmlToPlainText(row.html_body) : null),
    has_attachments: hasAttachments,
    from_name: fromMatch?.[1].replace(/^['"]|['"]$/g, '').trim() || undefined,
    from_address: fromMatch?.[2] ?? row.from_address,
    status: row.status,
    events,
    error: row.error_message ? sanitizeCustomerCopy(row.error_message) : null,
    relay_response: row.provider_id ? sanitizeCustomerCopy(row.provider_id) : null,
    message_id: row.message_id,
    scheduled_at: row.scheduled_at,
    created_at: row.created_at,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
