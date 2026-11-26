import { NextResponse } from 'next/server';
import { authorizeApiKey } from '@/lib/auth';
import { consumeSendLimit, execute, hashSecret, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { sendThroughSmtp } from '@/lib/smtp';
import { readJsonLimited } from '@/lib/request-json';
import { relayMessageIdFromResponse } from '@/lib/ses-events';
export const runtime = 'nodejs';
export const maxDuration = 30;

type SendBody = { from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
type StoredEmail = { id: string; from_address: string; to_json: string; subject: string; status: string; error_message: string | null; provider_id: string | null; message_id: string | null; created_at: string };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
function mailbox(value: string) {
  const match = /<([^<>]+)>$/.exec(value.trim());
  return (match?.[1] ?? value).trim().toLowerCase();
}
function responseError(error: string, status: number) { return NextResponse.json({ error: { message: error } }, { status }); }
function emailResponse(row: StoredEmail) {
  return { id: row.id, object: 'email', from: row.from_address, to: JSON.parse(row.to_json) as string[], subject: row.subject, status: row.status, created_at: row.created_at };
}
async function getStoredEmail(id: string) {
  return await queryOne<StoredEmail>('SELECT id,from_address,to_json,subject,status,error_message,provider_id,message_id,created_at FROM emails WHERE id=?', [id]);
}

export async function GET(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return responseError('Invalid or revoked API key.', 401);
  const url = new URL(request.url);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return responseError('limit must be an integer from 1 to 100.', 400);
  const after = url.searchParams.get('after');
  let rows: StoredEmail[];
  if (after !== null) {
    if (!after) return responseError('after must be a non-empty email ID.', 400);
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM emails WHERE id = ?', [after]);
    if (!cursor) return responseError('after must be an email ID available to this API key.', 400);
    rows = (await query<StoredEmail>(`SELECT id,from_address,to_json,subject,status,error_message,provider_id,message_id,created_at FROM emails
      WHERE (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC,id DESC LIMIT ?`, [cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<StoredEmail>(`SELECT id,from_address,to_json,subject,status,error_message,provider_id,message_id,created_at FROM emails
      ORDER BY created_at DESC,id DESC LIMIT ?`, [limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return NextResponse.json({ object: 'list', data: data.map(emailResponse), has_more: hasMore, ...(hasMore ? { next_after: data[data.length - 1]?.id } : {}) });
}

export async function POST(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return responseError('Invalid or revoked API key.', 401);
  if (!await consumeSendLimit(apiKey.id)) return responseError('Rate limit exceeded. Try again in the next minute.', 429);
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
  const verifiedDomains = (await query<{ domain: string }>('SELECT domain FROM domains WHERE verified_at IS NOT NULL')).rows;
  const domainAllowed = verifiedDomains.some(({ domain }) => senderDomain === domain || senderDomain.endsWith(`.${domain}`));
  if (!domainAllowed) return responseError('Verify the sender domain in your Send, thanks workspace before sending.', 403);

  const recipientAddresses = (to as string[]).map((address) => mailbox(address));
  const suppressedRecipients = (await query<{ address: string }>(
    `SELECT address FROM suppressions WHERE address IN (${recipientAddresses.map(() => '?').join(',')})`,
    recipientAddresses,
  )).rows;
  if (suppressedRecipients.length) {
    return NextResponse.json({
      error: { message: 'One or more recipients are on the block list and cannot receive email.', addresses: suppressedRecipients.map(({ address }) => address) },
    }, { status: 422 });
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null && !/^[\x21-\x7E]{1,256}$/.test(idempotencyKey)) return responseError('Idempotency-Key must be 1 to 256 visible ASCII characters.', 400);
  const requestHash = hashSecret(JSON.stringify({ from, to, subject, text: text ?? null, html: html ?? null }));
  if (idempotencyKey) {
    await execute('DELETE FROM idempotency_keys WHERE expires_at <= ?', [nowIso()]);
    const replay = await queryOne<StoredEmail & { request_hash: string }>(`SELECT i.request_hash,e.id,e.from_address,e.to_json,e.subject,e.status,e.error_message,e.provider_id,e.message_id,e.created_at
      FROM idempotency_keys i JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [apiKey.id, idempotencyKey, nowIso()]);
    if (replay) {
      if (replay.request_hash !== requestHash) return responseError('This Idempotency-Key was already used with a different request.', 409);
      const headers = { 'Idempotency-Replayed': 'true' };
      if (replay.status === 'failed') return NextResponse.json({ error: { message: 'Email could not be handed off. Check the message in your Send, thanks workspace.' }, id: replay.id }, { status: 502, headers });
      return NextResponse.json(emailResponse(replay), { status: replay.status === 'queued' ? 202 : 200, headers });
    }
  }

  const normalizedRecipients = (to as string[]).map((address) => address.trim().toLowerCase());
  const blockedRecipients = (await query<{ address: string }>(
    `SELECT address FROM blocked_addresses WHERE address IN (${normalizedRecipients.map(() => '?').join(',')})`,
    normalizedRecipients,
  )).rows;
  if (blockedRecipients.length) return responseError('One or more recipients are on this workspace’s block list.', 409);

  const id = randomId('em');
  const createdAt = nowIso();
  if (idempotencyKey) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      await transaction([
        { sql: `INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,created_at)
          VALUES(?,?,?,?,?,'queued',?)`, params: [id, apiKey.id, from, JSON.stringify(to), subject, createdAt] },
        { sql: `INSERT INTO idempotency_keys(api_key_id,idempotency_key,request_hash,email_id,expires_at,created_at)
          VALUES(?,?,?,?,?,?)`, params: [apiKey.id, idempotencyKey, requestHash, id, expiresAt, createdAt] },
      ]);
    } catch (error) {
      const replay = await queryOne<StoredEmail & { request_hash: string }>(`SELECT i.request_hash,e.id,e.from_address,e.to_json,e.subject,e.status,e.error_message,e.provider_id,e.message_id,e.created_at
        FROM idempotency_keys i JOIN emails e ON e.id=i.email_id WHERE i.api_key_id=? AND i.idempotency_key=? AND i.expires_at>?`, [apiKey.id, idempotencyKey, nowIso()]);
      if (!replay) throw error;
      if (replay.request_hash !== requestHash) return responseError('This Idempotency-Key was already used with a different request.', 409);
      return NextResponse.json(emailResponse(replay), { status: replay.status === 'queued' ? 202 : replay.status === 'failed' ? 502 : 200, headers: { 'Idempotency-Replayed': 'true' } });
    }
  } else {
    await execute(`INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,created_at)
      VALUES(?,?,?,?,?,'queued',?)`, [id, apiKey.id, from, JSON.stringify(to), subject, createdAt]);
  }

  try {
    const smtpResult = await sendThroughSmtp({ from, to: to as string[], subject, ...(text !== undefined ? { text } : {}), ...(html !== undefined ? { html } : {}) });
    await execute('UPDATE emails SET status = ?, provider_id = ?, message_id = ?, relay_message_id = ? WHERE id = ?', ['sent', smtpResult.response.slice(0, 500), smtpResult.messageId, relayMessageIdFromResponse(smtpResult.response), id]);
    const storedEmail = await getStoredEmail(id);
    if (!storedEmail) throw new Error('The sent email record could not be read.');
    return NextResponse.json(emailResponse(storedEmail), { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'SMTP delivery failed.';
    await execute('UPDATE emails SET status = ?, error_message = ? WHERE id = ?', ['failed', message, id]);
    return NextResponse.json({ error: { message: 'Email could not be handed off. Check the message in your Send, thanks workspace.' }, id }, { status: 502 });
  }
}
