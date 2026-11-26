import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { consumeWebhookLimit, execute, nowIso, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { parseSesNotification, parseSnsEnvelope, strongerStatus, trustedSnsUrl, verifySnsSignature } from '@/lib/ses-events';
export const runtime = 'nodejs';
export const maxDuration = 30;

const digest = (value: string) => createHash('sha256').update(value).digest();
function tokenMatches(request: Request) {
  const expected = process.env.EMAILGO_WEBHOOK_TOKEN?.trim();
  const supplied = new URL(request.url).searchParams.get('token') ?? '';
  return Boolean(expected) && timingSafeEqual(digest(supplied), digest(expected!));
}
function topicAllowed(topicArn: string) {
  const allowed = (process.env.EMAILGO_SNS_TOPIC_ARNS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(topicArn);
}
const reject = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
  if (!process.env.EMAILGO_WEBHOOK_TOKEN?.trim()) return reject('Delivery events are not configured.', 503);
  if (!tokenMatches(request)) return reject('Not authorised.', 401);
  const source = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'local';
  if (!await consumeWebhookLimit(createHash('sha256').update(source).digest('hex'))) return reject('Too many requests.', 429);
  const parsed = await readJsonLimited(request, 256_000);
  if (!parsed.ok) return reject(parsed.error, parsed.status);
  const envelope = parseSnsEnvelope(parsed.value);
  if (!envelope) return reject('Expected a signed delivery notification message.', 400);
  if (!topicAllowed(envelope.TopicArn)) return reject('Topic not allowed.', 403);
  if (!await verifySnsSignature(envelope)) return reject('Notification signature is invalid.', 403);

  if (envelope.Type === 'SubscriptionConfirmation') {
    const subscribeUrl = trustedSnsUrl(envelope.SubscribeURL);
    if (!subscribeUrl) return reject('Untrusted subscription URL.', 400);
    const confirmed = await fetch(subscribeUrl, { redirect: 'error', signal: AbortSignal.timeout(5_000) }).then((response) => response.ok).catch(() => false);
    return confirmed ? NextResponse.json({ subscribed: true }) : reject('Subscription confirmation failed.', 502);
  }
  if (envelope.Type !== 'Notification') return NextResponse.json({ ignored: envelope.Type });

  const events = parseSesNotification(envelope.Message);
  let recorded = 0;
  for (const event of events) {
    const email = await queryOne<{ id: string; status: string }>('SELECT id,status FROM emails WHERE relay_message_id = ?', [event.relayMessageId]);
    // Suppression and status writes are idempotent and run before the event is saved, so an SNS retry finishes a failed attempt.
    if (event.suppress) {
      await execute('INSERT INTO suppressions(address,reason,detail,created_at) VALUES(?,?,?,?) ON CONFLICT(address) DO NOTHING',
        [event.recipient, event.type, event.detail, nowIso()]);
    }
    // Compare-and-set so an overlapping copy with a stale read can never downgrade the status.
    for (let current = email; current;) {
      const status = strongerStatus(current.status, event.type);
      if (status === current.status) break;
      if (await execute('UPDATE emails SET status = ? WHERE id = ? AND status = ?', [status, current.id, current.status])) break;
      current = await queryOne<{ id: string; status: string }>('SELECT id,status FROM emails WHERE id = ?', [current.id]);
    }
    recorded += Number(await execute(`INSERT INTO delivery_events(id,sns_message_id,email_id,relay_message_id,event_type,recipient,detail,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sns_message_id,recipient) DO NOTHING`,
      [randomId('ev'), envelope.MessageId, email?.id ?? null, event.relayMessageId, event.type, event.recipient, event.detail, nowIso()]));
  }
  return NextResponse.json({ received: events.length, recorded });
}
