import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';

export function webhookDeliveryStatus(status: string) {
  if (status === 'delivered') return 'success';
  if (status === 'processing') return 'attempting';
  return status;
}

export async function listWebhookEvents(webhookId: string, limit: number, after: string | null) {
  let cursor: { created_at: string } | undefined;
  if (after !== null) {
    if (!after) return { ok: false as const, error: 'after must be a non-empty event ID.' };
    cursor = await queryOne<{ created_at: string }>('SELECT MIN(created_at) AS created_at FROM webhook_deliveries WHERE webhook_id=? AND event_id=? GROUP BY event_id', [webhookId, after]);
    if (!cursor) return { ok: false as const, error: 'after must be an event ID for this webhook.' };
  }
  const rows = await query<{ id: string; type: string; created_at: string; status: string }>(
    `SELECT d.event_id AS id,d.event_type AS type,MIN(d.created_at) AS created_at,
      (SELECT latest.status FROM webhook_deliveries latest WHERE latest.webhook_id=d.webhook_id AND latest.event_id=d.event_id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) AS status
      FROM webhook_deliveries d WHERE d.webhook_id=? GROUP BY d.webhook_id,d.event_id,d.event_type
      ${cursor ? 'HAVING MIN(d.created_at)<? OR (MIN(d.created_at)=? AND d.event_id<?)' : ''}
      ORDER BY MIN(d.created_at) DESC,d.event_id DESC LIMIT ?`,
    cursor ? [webhookId, cursor.created_at, cursor.created_at, after, limit + 1] : [webhookId, limit + 1],
  );
  const hasMore = rows.rows.length > limit;
  const data = rows.rows.slice(0, limit).map((row) => ({ ...row, status: webhookDeliveryStatus(row.status) }));
  return { ok: true as const, data, hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) };
}

export async function getWebhookEvent(webhookId: string, eventId: string) {
  const row = await queryOne<{ id: string; event_id: string; event_type: string; status: string; created_at: string; next_attempt_at: string | null; payload_json: string }>(
    `SELECT id,event_id,event_type,status,created_at,next_attempt_at,payload_json FROM webhook_deliveries
      WHERE webhook_id=? AND event_id=? ORDER BY created_at DESC,id DESC LIMIT 1`, [webhookId, eventId],
  );
  if (!row) return undefined;
  let payload: unknown = null;
  try { payload = JSON.parse(row.payload_json); } catch {}
  return { object: 'webhook_event', id: row.event_id, type: row.event_type, created_at: row.created_at, status: webhookDeliveryStatus(row.status), next_attempt_at: row.next_attempt_at, payload };
}

export async function listWebhookEventAttempts(webhookId: string, eventId: string, limit: number, after: string | null) {
  let cursor: { attempted_at: string; id: string } | undefined;
  if (after !== null) {
    if (!after) return { ok: false as const, error: 'after must be a non-empty attempt ID.' };
    cursor = await queryOne<{ attempted_at: string; id: string }>(`SELECT a.id,a.attempted_at FROM webhook_delivery_attempts a
      JOIN webhook_deliveries d ON d.id=a.delivery_id WHERE d.webhook_id=? AND d.event_id=? AND a.id=?`, [webhookId, eventId, after]);
    if (!cursor) return { ok: false as const, error: 'after must be an attempt ID for this event.' };
  }
  const rows = await query<{ id: string; http_status_code: number | null; response: string | null; sent_at: string }>(
    `SELECT a.id,a.status_code AS http_status_code,a.response_excerpt AS response,a.attempted_at AS sent_at
      FROM webhook_delivery_attempts a JOIN webhook_deliveries d ON d.id=a.delivery_id
      WHERE d.webhook_id=? AND d.event_id=? ${cursor ? 'AND (a.attempted_at<? OR (a.attempted_at=? AND a.id<?))' : ''}
      ORDER BY a.attempted_at DESC,a.id DESC LIMIT ?`,
    cursor ? [webhookId, eventId, cursor.attempted_at, cursor.attempted_at, cursor.id, limit + 1] : [webhookId, eventId, limit + 1],
  );
  const hasMore = rows.rows.length > limit;
  const data = rows.rows.slice(0, limit);
  return { ok: true as const, data, hasMore, ...(hasMore ? { next_after: data.at(-1)?.id } : {}) };
}

export async function replayWebhookEvent(webhookId: string, eventId: string) {
  const latest = await queryOne<{ event_id: string; api_key_id: string; event_type: string; payload_json: string }>(
    `SELECT event_id,api_key_id,event_type,payload_json FROM webhook_deliveries WHERE webhook_id=? AND event_id=? ORDER BY created_at DESC,id DESC LIMIT 1`, [webhookId, eventId],
  );
  if (!latest) return undefined;
  const deliveryId = randomId('whd');
  const createdAt = nowIso();
  await execute(`INSERT INTO webhook_deliveries(id,event_id,webhook_id,api_key_id,event_type,payload_json,status,attempt_count,created_at)
    VALUES(?,?,?,?,?,?,'pending',0,?)`, [deliveryId, latest.event_id, webhookId, latest.api_key_id, latest.event_type, latest.payload_json, createdAt]);
  return { event_id: latest.event_id, delivery_id: deliveryId, status: 'pending', replayed: true };
}
