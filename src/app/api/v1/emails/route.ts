import { NextResponse } from 'next/server';
import { authorizeApiKey } from '@/lib/auth';
import { consumeSendLimit, getDatabase, nowIso, randomId } from '@/lib/database';
import { sendThroughSmtp } from '@/lib/smtp';
import { readJsonLimited } from '@/lib/request-json';
export const runtime = 'nodejs';
export const maxDuration = 30;

type SendBody = { from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
function mailbox(value: string) {
  const match = /<([^<>]+)>$/.exec(value.trim());
  return (match?.[1] ?? value).trim().toLowerCase();
}
function responseError(error: string, status: number) { return NextResponse.json({ error: { message: error } }, { status }); }

export async function POST(request: Request) {
  const apiKey = authorizeApiKey(request);
  if (!apiKey) return responseError('Invalid or revoked API key.', 401);
  if (!consumeSendLimit(apiKey.id)) return responseError('Rate limit exceeded. Try again in the next minute.', 429);
  const parsed = await readJsonLimited(request, 1_000_000);
  if (!parsed.ok) return responseError(parsed.error, parsed.status);
  const body = parsed.value as SendBody;
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const sender = mailbox(from);
  const to = typeof body.to === 'string' ? [body.to] : Array.isArray(body.to) ? body.to : [];
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.text === 'string' ? body.text : undefined;
  const html = typeof body.html === 'string' ? body.html : undefined;
  if (!from || from.length > 254 || /[\r\n]/.test(from) || !emailPattern.test(sender)) return responseError('A valid from email address is required.', 400);
  if (!to.length || to.length > 50 || !to.every((address) => typeof address === 'string' && address.length <= 254 && emailPattern.test(address))) return responseError('to must contain between 1 and 50 valid email addresses.', 400);
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) return responseError('subject must be 1 to 998 characters and cannot contain line breaks.', 400);
  if (text === undefined && html === undefined) return responseError('Provide text, html, or both.', 400);
  if ((text?.length ?? 0) > 500_000 || (html?.length ?? 0) > 500_000) return responseError('Email content exceeds the 500 KB limit.', 413);
  const senderDomain = sender.slice(sender.lastIndexOf('@') + 1);
  const database = getDatabase();
  const verifiedDomains = database.prepare('SELECT domain FROM domains WHERE verified_at IS NOT NULL').all() as Array<{ domain: string }>;
  const domainAllowed = verifiedDomains.some(({ domain }) => senderDomain === domain || senderDomain.endsWith(`.${domain}`));
  if (!domainAllowed) return responseError('The sender domain must be verified in your Emailgo dashboard.', 403);
  const id = randomId('em');
  const createdAt = nowIso();
  database.prepare(`INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,created_at)
    VALUES(?,?,?,?,?,'queued',?)`).run(id, apiKey.id, from, JSON.stringify(to), subject, createdAt);
  try {
    const smtpResult = await sendThroughSmtp({ from, to: to as string[], subject, ...(text ? { text } : {}), ...(html ? { html } : {}) });
    database.prepare('UPDATE emails SET status = ?, provider_id = ? WHERE id = ?').run('sent', smtpResult.response.slice(0, 500), id);
    return NextResponse.json({ id, object: 'email', status: 'sent', messageId: smtpResult.messageId }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'SMTP delivery failed.';
    database.prepare('UPDATE emails SET status = ?, error_message = ? WHERE id = ?').run('failed', message, id);
    return responseError('Email delivery failed. Check the message details in your Emailgo dashboard.', 502);
  }
}
