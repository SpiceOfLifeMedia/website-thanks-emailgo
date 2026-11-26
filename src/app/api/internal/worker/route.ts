import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, nowIso, query } from '@/lib/database';
import { sendThroughSmtp, smtpConfigured, type OutboundAttachment } from '@/lib/smtp';
import { trackedHtml } from '@/lib/tracking';
import { emitEmailSuppressed, findSuppressedAddresses, normalizeSuppressionAddress } from '@/lib/suppressions';
import { deliverDueWebhooks, emitWebhookEvent } from '@/lib/webhooks';
import { processAutomationRuns } from '@/lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ScheduledEmail = {
  id: string;
  api_key_id: string;
  from_address: string;
  to_json: string;
  cc_json: string | null;
  bcc_json: string | null;
  reply_to: string | null;
  headers_json: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  attachment_payload_json: string | null;
  track_opens: number;
  track_clicks: number;
  attempt_count: number;
  scheduled_at: string;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  if (!secret || !authorization.startsWith('Bearer ')) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const now = nowIso();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const due = await query<ScheduledEmail>(`SELECT id,api_key_id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,subject,text_body,html_body,
      attachment_payload_json,attempt_count,scheduled_at,track_opens,track_clicks
    FROM emails
    WHERE (status='scheduled' AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?))
       OR (status='processing' AND processing_started_at<=?)
    ORDER BY scheduled_at ASC,id ASC LIMIT 10`, [now, now, staleBefore]);

  let nextIndex = 0;
  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let deferred = 0;
  const workers = Array.from({ length: Math.min(5, due.rows.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      const email = due.rows[index];
      if (!email) return;
      const claimedAt = nowIso();
      const claimed = await execute(`UPDATE emails SET status='processing',processing_started_at=?,attempt_count=attempt_count+1,next_attempt_at=NULL
        WHERE id=? AND ((status='scheduled' AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?))
        OR (status='processing' AND processing_started_at<=?))`, [claimedAt, email.id, now, now, staleBefore]);
      if (!claimed) { deferred += 1; continue; }

      const attempt = email.attempt_count + 1;
      try {
        const requestedTo = jsonValue<string[]>(email.to_json, []);
        const requestedCc = jsonValue<string[]>(email.cc_json, []);
        const requestedBcc = jsonValue<string[]>(email.bcc_json, []);
        const allRequestedRecipients = [...requestedTo, ...requestedCc, ...requestedBcc];
        const blocked = await findSuppressedAddresses(allRequestedRecipients);
        const blockedEmails = new Set(blocked.map((row) => row.normalized_email));
        const to = requestedTo.filter((address) => !blockedEmails.has(normalizeSuppressionAddress(address)));
        const cc = requestedCc.filter((address) => !blockedEmails.has(normalizeSuppressionAddress(address)));
        const bcc = requestedBcc.filter((address) => !blockedEmails.has(normalizeSuppressionAddress(address)));
        if (blocked.length) {
          await Promise.all(blocked.map((row) => emitEmailSuppressed(email.api_key_id, email.id, email.from_address, row.email, email.subject)));
          await execute('UPDATE emails SET to_json=?,cc_json=?,bcc_json=? WHERE id=? AND status=?', [JSON.stringify(to), cc.length ? JSON.stringify(cc) : null, bcc.length ? JSON.stringify(bcc) : null, email.id, 'processing']);
        }
        if (to.length + cc.length + bcc.length === 0) {
          await execute("UPDATE emails SET status='suppressed',error_message=?,processing_started_at=NULL,next_attempt_at=NULL,attachment_payload_json=NULL WHERE id=? AND status='processing'", [
            'Every recipient was skipped because the address is on the Emailgo suppression list.', email.id,
          ]);
          suppressed += 1;
          continue;
        }
        const attachments = jsonValue<OutboundAttachment[]>(email.attachment_payload_json, []);
        if (!Array.isArray(attachments) || attachments.some((attachment) => !attachment || typeof attachment.filename !== 'string' || typeof attachment.content !== 'string')) throw new Error('Scheduled attachment data is invalid.');
        const tracking = { openTracking: Boolean(email.track_opens), clickTracking: Boolean(email.track_clicks) };
        const html = email.html_body !== null && (tracking.openTracking || tracking.clickTracking)
          ? trackedHtml(email.id, email.html_body, tracking)
          : email.html_body;
        const result = await sendThroughSmtp({
          from: email.from_address,
          to,
          cc,
          bcc,
          ...(email.reply_to ? { replyTo: email.reply_to } : {}),
          subject: email.subject,
          ...(email.text_body !== null ? { text: email.text_body } : {}),
          ...(html !== null ? { html } : {}),
          ...(email.headers_json ? { headers: jsonValue<Record<string, string>>(email.headers_json, {}) } : {}),
          ...(attachments.length ? { attachments } : {}),
        });
        await execute('UPDATE emails SET status=?,provider_id=?,message_id=?,error_message=NULL,processing_started_at=NULL,next_attempt_at=NULL,attachment_payload_json=NULL WHERE id=? AND status=?', [
          'sent', result.response.slice(0, 500), result.messageId, email.id, 'processing',
        ]);
        await emitWebhookEvent(email.api_key_id, 'email.sent', { email_id: email.id, from: email.from_address, to: jsonValue<string[]>(email.to_json, []), subject: email.subject, message_id: result.messageId });
        sent += 1;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message.slice(0, 500) : 'SMTP delivery failed.';
        if (attempt < 3) {
          const retryAt = new Date(Date.now() + 60_000 * (2 ** (attempt - 1))).toISOString();
          await execute('UPDATE emails SET status=?,error_message=?,processing_started_at=NULL,next_attempt_at=? WHERE id=? AND status=?', [
            'scheduled', message, retryAt, email.id, 'processing',
          ]);
          deferred += 1;
        } else {
          await execute('UPDATE emails SET status=?,error_message=?,processing_started_at=NULL,next_attempt_at=NULL,attachment_payload_json=NULL WHERE id=? AND status=?', [
            'failed', message, email.id, 'processing',
          ]);
          await emitWebhookEvent(email.api_key_id, 'email.failed', { email_id: email.id, error: 'SMTP handoff failed after three attempts.' });
          failed += 1;
        }
      }
    }
  });
  await Promise.all(workers);
  await execute(`UPDATE broadcasts SET status=CASE
      WHEN EXISTS(SELECT 1 FROM emails e WHERE e.broadcast_id=broadcasts.id AND e.status='processing') THEN 'sending'
      WHEN EXISTS(SELECT 1 FROM emails e WHERE e.broadcast_id=broadcasts.id AND e.status='scheduled' AND e.scheduled_at<=? AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=?)) THEN 'sending'
      WHEN EXISTS(SELECT 1 FROM emails e WHERE e.broadcast_id=broadcasts.id AND e.status='scheduled') THEN 'scheduled'
      ELSE 'sent' END,updated_at=?
    WHERE status IN ('queued','scheduled','sending') AND recipient_count>0`, [now, now, nowIso()]);
  const webhooks = await deliverDueWebhooks();
  const automations = await processAutomationRuns(5);
  return NextResponse.json({ ok: true, checked: due.rows.length, sent, failed, suppressed, deferred, webhooks, automations, smtp_configured: smtpConfigured(), checked_at: now });
}
