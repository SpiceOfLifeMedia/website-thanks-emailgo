export type BroadcastCreateOptions = { send: boolean; scheduledAt?: string };

export function parseBroadcastCreateOptions(value: unknown, now = Date.now()): { ok: true; options: BroadcastCreateOptions } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Request body must be a JSON object.' };
  const body = value as Record<string, unknown>;
  if (body.send !== undefined && typeof body.send !== 'boolean') return { ok: false, error: 'send must be a boolean.' };
  const send = body.send === true;
  const hasSnakeTime = Object.hasOwn(body, 'scheduled_at');
  const hasCamelTime = Object.hasOwn(body, 'scheduledAt');
  if (hasSnakeTime && hasCamelTime) return { ok: false, error: 'Use either scheduled_at or scheduledAt, not both.' };
  if (!hasSnakeTime && !hasCamelTime) return { ok: true, options: { send } };
  if (!send) return { ok: false, error: 'scheduled_at requires send to be true.' };
  const scheduledValue = hasSnakeTime ? body.scheduled_at : body.scheduledAt;
  if (typeof scheduledValue !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(scheduledValue) || !Number.isFinite(Date.parse(scheduledValue))) {
    return { ok: false, error: 'scheduled_at must be an ISO 8601 timestamp.' };
  }
  const timestamp = Date.parse(scheduledValue);
  if (timestamp <= now) return { ok: false, error: 'scheduled_at must be in the future.' };
  if (timestamp > now + 30 * 24 * 60 * 60 * 1000) return { ok: false, error: 'scheduled_at cannot be more than 30 days in the future.' };
  return { ok: true, options: { send, scheduledAt: new Date(timestamp).toISOString() } };
}
