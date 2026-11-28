import { NextResponse } from 'next/server';
import { createContactPreferenceToken } from '@/lib/contact-preferences';
import { execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { authorizeBroadcastRequest, eligibleBroadcastContacts, type BroadcastInput, validateBroadcastInput } from '@/lib/broadcasts';
import { readJsonLimited } from '@/lib/request-json';
import { smtpConfigured } from '@/lib/smtp';
import { checkEmailLinks, type EmailLinkIssue } from '@/lib/email-link-checker';
import { addBroadcastPreheader, broadcastContactVariables, renderBroadcastContent } from '@/lib/broadcast-template';
import { normalizeScheduledAt } from '@/lib/scheduled-time';
import { emitWebhookEvents, type WebhookEventInput } from '@/lib/webhooks';
import { resolvePlainText } from '@/lib/plain-text';

export const runtime = 'nodejs';
export const maxDuration = 30;
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

class BroadcastLinkValidationError extends Error {
  constructor(readonly issues: EmailLinkIssue[]) { super('Broadcast links need attention.'); }
}

function htmlEscape(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Scheduled worker is not configured.' }, { status: 503, headers: privateHeaders });
  if (!smtpConfigured()) return NextResponse.json({ error: 'SMTP delivery is not configured.' }, { status: 503, headers: privateHeaders });
  if (!process.env.EMAILGO_PREFERENCES_SECRET || process.env.EMAILGO_PREFERENCES_SECRET.length < 32) return NextResponse.json({ error: 'EMAILGO_PREFERENCES_SECRET must contain at least 32 characters before a broadcast can be queued.' }, { status: 503, headers: privateHeaders });
  if (!process.env.EMAILGO_PUBLIC_URL) return NextResponse.json({ error: 'Set EMAILGO_PUBLIC_URL before queuing a broadcast.' }, { status: 503, headers: privateHeaders });
  let publicOrigin: URL;
  try { publicOrigin = new URL(process.env.EMAILGO_PUBLIC_URL); }
  catch { return NextResponse.json({ error: 'EMAILGO_PUBLIC_URL must be a valid public URL.' }, { status: 503, headers: privateHeaders }); }
  if (process.env.NODE_ENV === 'production' && publicOrigin.protocol !== 'https:') return NextResponse.json({ error: 'EMAILGO_PUBLIC_URL must use HTTPS in production.' }, { status: 503, headers: privateHeaders });

  const { id } = await context.params;
  const campaign = await queryOne<BroadcastInput & { id: string; status: string }>('SELECT id,name,api_key_id AS "apiKeyId",from_address AS "from",subject,reply_to AS "replyTo",preview_text AS "previewText",text_body AS text,html_body AS html,audience_type AS "audienceType",audience_id AS "audienceId",status FROM broadcasts WHERE id=?', [id]);
  if (!campaign) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: privateHeaders });
  if (campaign.status !== 'draft') return NextResponse.json({ error: 'Only draft broadcasts can be queued.' }, { status: 409, headers: privateHeaders });
  const validated = await validateBroadcastInput(campaign);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: validated.status, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400, headers: privateHeaders });
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== 'scheduled_at')) return NextResponse.json({ error: 'Only scheduled_at is supported.' }, { status: 400, headers: privateHeaders });
  let scheduledAt = nowIso();
  if (body.scheduled_at !== undefined) {
    const schedule = normalizeScheduledAt(body.scheduled_at);
    if (!schedule.ok) return NextResponse.json({ error: schedule.error }, { status: 400, headers: privateHeaders });
    scheduledAt = schedule.scheduledAt;
  }
  const fromAddress = /<([^<>]+)>$/.exec(campaign.from)?.[1] ?? campaign.from;
  if (!emailPattern.test(fromAddress)) return NextResponse.json({ error: 'The broadcast sender is invalid.' }, { status: 400, headers: privateHeaders });
  const senderDomain = fromAddress.slice(fromAddress.lastIndexOf('@') + 1).toLowerCase();
  const verifiedDomainRows = await query<{ domain: string; open_tracking: number; click_tracking: number }>('SELECT domain,open_tracking,click_tracking FROM domains WHERE verified_at IS NOT NULL');
  const senderDomainConfig = verifiedDomainRows.rows.filter((domain) => senderDomain === domain.domain.toLowerCase() || senderDomain.endsWith(`.${domain.domain.toLowerCase()}`)).sort((a, b) => b.domain.length - a.domain.length)[0];
  if (!senderDomainConfig) return NextResponse.json({ error: 'The broadcast sender domain is no longer verified.' }, { status: 403, headers: privateHeaders });
  const tracking = { open: Boolean(senderDomainConfig.open_tracking), click: Boolean(senderDomainConfig.click_tracking) };
  if ((tracking.open || tracking.click) && (!process.env.EMAILGO_TRACKING_SECRET || !process.env.EMAILGO_PUBLIC_URL)) return NextResponse.json({ error: 'Tracking is enabled but its URL or signing secret is missing.' }, { status: 503, headers: privateHeaders });

  const active = await execute("UPDATE broadcasts SET status='queuing',updated_at=? WHERE id=? AND status='draft'", [nowIso(), id]);
  if (!active) return NextResponse.json({ error: 'This broadcast has already been queued.' }, { status: 409, headers: privateHeaders });
  try {
    const recipients = await eligibleBroadcastContacts(campaign, 1001);
    if (!recipients.length) {
      await execute("UPDATE broadcasts SET status='draft',updated_at=? WHERE id=? AND status='queuing'", [nowIso(), id]);
      return NextResponse.json({ error: 'No opted-in, subscribed contacts match this audience.' }, { status: 409, headers: privateHeaders });
    }
    if (recipients.length > 1000) {
      await execute("UPDATE broadcasts SET status='draft',updated_at=? WHERE id=? AND status='queuing'", [nowIso(), id]);
      return NextResponse.json({ error: 'A broadcast is limited to 1,000 recipients per send. Narrow the saved audience and create another broadcast for the remaining contacts.' }, { status: 413, headers: privateHeaders });
    }
    const propertyWorkspace = await queryOne<{ workspace_id: string }>('SELECT workspace_id FROM api_keys WHERE id=? AND revoked_at IS NULL', [campaign.apiKeyId]);
    if (!propertyWorkspace) throw new Error('The broadcast API key is no longer active.');
    const propertyFallbacks = (await query<{ property_key: string; fallback_value_json: string | null }>('SELECT property_key,fallback_value_json FROM contact_properties WHERE workspace_id=? AND fallback_value_json IS NOT NULL', [propertyWorkspace.workspace_id])).rows;
    const baseStatements: Array<{ sql: string; params: readonly unknown[] }> = [];
    const scheduledEvents: WebhookEventInput[] = [];
    for (const recipient of recipients) {
      const emailId = randomId('em');
      const preferenceToken = createContactPreferenceToken({ contactId: recipient.id, email: recipient.email, emailId });
      const preferencesUrl = `${publicOrigin.origin}/preferences/${preferenceToken}`;
      const unsubscribeUrl = `${publicOrigin.origin}/api/preferences/${preferenceToken}/one-click`;
      let properties: Record<string, unknown> = {};
      try { properties = JSON.parse(recipient.properties_json) as Record<string, unknown>; } catch {}
      for (const property of propertyFallbacks) {
        if (properties[property.property_key] === undefined || properties[property.property_key] === null) {
          try { properties[property.property_key] = JSON.parse(property.fallback_value_json ?? 'null'); } catch {}
        }
      }
      const values = broadcastContactVariables({ properties, email: recipient.email, name: recipient.name, preferencesUrl, unsubscribeUrl });
      const subject = renderBroadcastContent(campaign.subject, values, false)?.replace(/[\r\n]/g, ' ').trim() ?? '';
      if (!subject || subject.length > 998) throw new Error('A rendered broadcast subject is invalid.');
      const textBody = renderBroadcastContent(campaign.text, values, false);
      const htmlBody = renderBroadcastContent(campaign.html, values, true);
      const previewText = renderBroadcastContent(campaign.previewText, values, false);
      const textWithFooter = textBody === null ? null : `${textBody}\n\nManage preferences: ${preferencesUrl}\nUnsubscribe: ${unsubscribeUrl}`;
      const htmlWithPreheader = addBroadcastPreheader(htmlBody, previewText);
      const htmlWithFooter = htmlWithPreheader === null ? null : `${htmlWithPreheader}<div style="margin-top:24px;font-size:12px;color:#666"><a href="${htmlEscape(preferencesUrl)}">Manage preferences</a> · <a href="${htmlEscape(unsubscribeUrl)}">Unsubscribe</a></div>`;
      const resolvedText = resolvePlainText(textWithFooter, htmlWithFooter);
      const linkIssues = checkEmailLinks(htmlWithFooter, resolvedText);
      if (linkIssues.length) throw new BroadcastLinkValidationError(linkIssues);
      const createdAt = nowIso();
      if (Date.parse(scheduledAt) > Date.now()) {
        scheduledEvents.push({
          type: 'email.scheduled',
          data: { email_id: emailId, from: campaign.from, to: [recipient.email], subject, scheduled_at: scheduledAt },
          stableEventId: `email.scheduled:${emailId}`,
        });
      }
      baseStatements.push({
        sql: `INSERT INTO emails(id,api_key_id,from_address,to_json,reply_to,subject,status,headers_json,text_body,html_body,scheduled_at,track_opens,track_clicks,broadcast_id,created_at)
          VALUES(?,?,?,?,?,?,'scheduled',?,?,?,?,?,?,?,?)`,
        params: [emailId, campaign.apiKeyId, campaign.from, JSON.stringify([recipient.email]), campaign.replyTo, subject,
          JSON.stringify({ 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
          resolvedText, htmlWithFooter, scheduledAt, tracking.open ? 1 : 0, tracking.click ? 1 : 0, id, createdAt],
      });
    }
    const finalStatus = Date.parse(scheduledAt) > Date.now() ? 'scheduled' : 'queued';
    baseStatements.push({
      sql: 'UPDATE broadcasts SET status=?,scheduled_at=?,recipient_count=?,updated_at=? WHERE id=? AND status=?',
      params: [finalStatus, scheduledAt, recipients.length, nowIso(), id, 'queuing'],
    });
    await transaction(baseStatements);
    await emitWebhookEvents(campaign.apiKeyId, scheduledEvents);
    return NextResponse.json({ id, status: finalStatus, recipient_count: recipients.length, scheduled_at: scheduledAt }, { status: 202, headers: privateHeaders });
  } catch (cause) {
    await execute("UPDATE broadcasts SET status='draft',updated_at=? WHERE id=? AND status='queuing'", [nowIso(), id]);
    if (cause instanceof BroadcastLinkValidationError) return NextResponse.json({ error: 'Review the broadcast links before queuing this message.', link_issues: cause.issues }, { status: 422, headers: privateHeaders });
    const message = cause instanceof Error ? cause.message : 'Could not queue the broadcast.';
    return NextResponse.json({ error: message }, { status: 500, headers: privateHeaders });
  }
}
