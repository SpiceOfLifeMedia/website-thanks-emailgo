import { createHash, randomBytes } from 'node:crypto';
import type { WebhookEventType } from '@/lib/webhook-event-types';

export type WebhookEventInput = { type: WebhookEventType; data: Record<string, unknown>; stableEventId?: string };
export type WebhookDeliveryStatement = { sql: string; params: readonly unknown[] };
export type WebhookSubscription = { id: string; api_key_id: string; events_json: string };

function randomDeliveryId() {
  return `whd_${randomBytes(12).toString('hex')}`;
}

function subscribed(row: WebhookSubscription, type: WebhookEventType) {
  try { return (JSON.parse(row.events_json) as string[]).includes(type); } catch { return false; }
}

export function buildWebhookEventStatements(rows: WebhookSubscription[], events: readonly WebhookEventInput[], createdAt: string): WebhookDeliveryStatement[] {
  const statements: WebhookDeliveryStatement[] = [];
  for (const event of events) {
    const eventId = event.stableEventId ?? `evt_${randomBytes(12).toString('hex')}`;
    const payload = JSON.stringify({ type: event.type, created_at: createdAt, data: { ...event.data, event_id: eventId, created_at: createdAt } });
    for (const webhook of rows) {
      if (!subscribed(webhook, event.type)) continue;
      const deliveryId = event.stableEventId
        ? `whd_${createHash('sha256').update(`${webhook.id}\0${event.stableEventId}`).digest('hex').slice(0, 32)}`
        : randomDeliveryId();
      statements.push({
        sql: `INSERT INTO webhook_deliveries(id,event_id,webhook_id,api_key_id,event_type,payload_json,status,created_at)
          VALUES(?,?,?,?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING`,
        params: [deliveryId, eventId, webhook.id, webhook.api_key_id, event.type, payload, createdAt],
      });
    }
  }
  return statements;
}
