import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { execute, nowIso, query, randomId, transaction } from '@/lib/database';
import type { WebhookEventType } from '@/lib/webhook-event-types';
import { buildWebhookEventStatements, type WebhookDeliveryStatement, type WebhookEventInput, type WebhookSubscription } from '@/lib/webhook-event-queue';

export { WEBHOOK_EVENT_TYPES, validateWebhookEvents } from '@/lib/webhook-event-types';
export type { WebhookEventType } from '@/lib/webhook-event-types';

type WebhookRow = { id: string; api_key_id: string; endpoint: string; events_json: string; secret_generation: number };
type Address = { address: string; family: number };
export type { WebhookEventInput } from '@/lib/webhook-event-queue';

export function webhookMasterSecret() {
  const secret = process.env.EMAILGO_WEBHOOK_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function getWebhookSecret(id: string, generation: number) {
  const master = webhookMasterSecret();
  if (!master) throw new Error('EMAILGO_WEBHOOK_SECRET must be set to a random value of at least 32 characters.');
  const derived = createHmac('sha256', master).update(`emailgo:webhook:${id}:${generation}`).digest('base64url');
  return `whsec_${derived}`;
}

export function validateWebhookEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
    if (url.port && url.port !== '443') return null;
    return url.toString();
  } catch { return null; }
}

export async function webhookEventStatements(apiKeyId: string, events: readonly WebhookEventInput[]) {
  const rows = await query<WebhookRow>('SELECT id,api_key_id,endpoint,events_json,secret_generation FROM webhooks WHERE api_key_id=? AND disabled_at IS NULL', [apiKeyId]);
  return buildWebhookEventStatements(rows.rows, events, nowIso());
}

async function commitWebhookEventStatements(statements: readonly WebhookDeliveryStatement[]) {
  for (let index = 0; index < statements.length; index += 1000) await transaction(statements.slice(index, index + 1000));
}

export async function emitWebhookEvents(apiKeyId: string, events: readonly WebhookEventInput[]) {
  if (!events.length) return true;
  try {
    await commitWebhookEventStatements(await webhookEventStatements(apiKeyId, events));
    return true;
  } catch {
    console.error('Email, thanks could not queue webhook events.', { types: [...new Set(events.map(({ type }) => type))] });
    return false;
  }
}

export async function emitWebhookEvent(apiKeyId: string, type: WebhookEventType, data: Record<string, unknown>, stableEventId?: string) {
  return emitWebhookEvents(apiKeyId, [{ type, data, stableEventId }]);
}

export async function emitWebhookEventToAllSubscribers(workspaceId: string, type: WebhookEventType, data: Record<string, unknown>, stableEventId?: string) {
  try {
    const rows = await query<WebhookRow>(`SELECT w.id,w.api_key_id,w.endpoint,w.events_json,w.secret_generation
      FROM webhooks w JOIN api_keys k ON k.id=w.api_key_id
      WHERE w.disabled_at IS NULL AND k.revoked_at IS NULL AND k.workspace_id=?`, [workspaceId]);
    const statements = buildWebhookEventStatements(rows.rows as WebhookSubscription[], [{ type, data, stableEventId }], nowIso());
    await commitWebhookEventStatements(statements);
    return true;
  } catch {
    console.error('Email, thanks could not queue a webhook event.', { type });
    return false;
  }
}

function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return publicAddress(mapped);
    const hex = mapped.split(':');
    if (hex.length >= 2) {
      const first = Number.parseInt(hex.at(-2) ?? '', 16);
      const second = Number.parseInt(hex.at(-1) ?? '', 16);
      return publicAddress(`${first >> 8}.${first & 255}.${second >> 8}.${second & 255}`);
    }
    return false;
  }
  return value.startsWith('2') && !value.startsWith('2001:db8:') && !value.startsWith('2001:0:') && !value.startsWith('2002:');
}

async function resolvePublicAddress(hostname: string): Promise<Address> {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!publicAddress(hostname)) throw new Error('Webhook host must resolve to a public address.');
    return { address: hostname, family: literalFamily };
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Webhook host must resolve to a public address.');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const results = addresses as Address[];
  if (!results.length || results.some(({ address }) => !publicAddress(address))) throw new Error('Webhook host must resolve only to public addresses.');
  return results[0];
}

function postWebhook(urlValue: string, payload: string, deliveryId: string, signingSecret: string) {
  return new Promise<{ status: number; excerpt: string }>(async (resolve, reject) => {
    let target: URL;
    let pinned: Address;
    try {
      target = new URL(urlValue);
      pinned = await resolvePublicAddress(target.hostname);
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error('Webhook endpoint DNS lookup failed.'));
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', Buffer.from(signingSecret.slice(6), 'base64url'))
      .update(`${deliveryId}.${timestamp}.${payload}`).digest('base64');
    const req = httpsRequest(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'user-agent': 'Email, thanks-Webhooks/1.0',
        'svix-id': deliveryId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
      timeout: 10_000,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer | string) => {
        if (size < 2048) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(buffer.subarray(0, 2048 - size));
          size += Math.min(buffer.length, 2048 - size);
        }
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 0, excerpt: Buffer.concat(chunks).toString('utf8').slice(0, 500) }));
    });
    req.on('timeout', () => req.destroy(new Error('Webhook endpoint timed out.')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function deliverDueWebhooks(limit = 20) {
  const now = nowIso();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const due = await query<{
    id: string; event_id: string; webhook_id: string; endpoint: string; secret_generation: number;
    payload_json: string; attempt_count: number; status: string;
  }>(`SELECT d.id,d.event_id,d.webhook_id,w.endpoint,w.secret_generation,d.payload_json,d.attempt_count,d.status
      FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
      WHERE w.disabled_at IS NULL AND ((d.status='pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?))
        OR (d.status='processing' AND d.processing_started_at<=?))
      ORDER BY d.created_at ASC,d.id ASC LIMIT ?`, [now, staleBefore, limit]);
  let delivered = 0;
  let failed = 0;
  let deferred = 0;
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(5, due.rows.length) }, async () => {
    while (true) {
      const item = due.rows[nextIndex++];
      if (!item) return;
      const claimedAt = nowIso();
      const claimed = await execute(`UPDATE webhook_deliveries SET status='processing',processing_started_at=?,attempt_count=attempt_count+1
        WHERE id=? AND EXISTS (SELECT 1 FROM webhooks w WHERE w.id=webhook_deliveries.webhook_id AND w.disabled_at IS NULL)
        AND ((status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?))
        OR (status='processing' AND processing_started_at<=?))`, [claimedAt, item.id, now, staleBefore]);
      if (!claimed) { deferred += 1; continue; }
      const attempt = item.attempt_count + 1;
      const started = Date.now();
      const attemptedAt = nowIso();
      let response: { status: number; excerpt: string } | null = null;
      let failure: string | null = null;
      try {
        const secret = getWebhookSecret(item.webhook_id, item.secret_generation);
        response = await postWebhook(item.endpoint, item.payload_json, item.event_id, secret);
        if (response.status < 200 || response.status >= 300) failure = `Webhook endpoint returned HTTP ${response.status}.`;
      } catch (cause) {
        failure = cause instanceof Error ? cause.message.slice(0, 300) : 'Webhook delivery failed.';
      }
      await execute(`INSERT INTO webhook_delivery_attempts(id,delivery_id,attempt_number,attempted_at,duration_ms,status_code,response_excerpt,error_message)
        VALUES(?,?,?,?,?,?,?,?)`, [randomId('wha'), item.id, attempt, attemptedAt, Math.max(0, Date.now() - started), response?.status ?? null, response?.excerpt ?? null, failure]);
      if (!failure && response) {
        await execute(`UPDATE webhook_deliveries SET status='delivered',delivered_at=?,last_attempt_at=?,last_status_code=?,
          last_response_excerpt=?,last_error=NULL,processing_started_at=NULL,next_attempt_at=NULL WHERE id=? AND status='processing'`,
        [nowIso(), attemptedAt, response.status, response.excerpt, item.id]);
        delivered += 1;
      } else {
        const done = attempt >= 5;
        const retryMinutes = [1, 5, 30, 120][attempt - 1] ?? 360;
        const retryAt = done ? null : new Date(Date.now() + retryMinutes * 60_000).toISOString();
        await execute(`UPDATE webhook_deliveries SET status=?,last_attempt_at=?,last_status_code=?,last_response_excerpt=?,
          last_error=?,processing_started_at=NULL,next_attempt_at=? WHERE id=? AND status='processing'`,
        [done ? 'failed' : 'pending', attemptedAt, response?.status ?? null, response?.excerpt ?? null, failure, retryAt, item.id]);
        if (done) failed += 1;
        else deferred += 1;
      }
    }
  });
  await Promise.all(workers);
  return { checked: due.rows.length, delivered, failed, deferred };
}
