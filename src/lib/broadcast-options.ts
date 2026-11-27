import { normalizeScheduledAt } from './scheduled-time.ts';

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
  const schedule = normalizeScheduledAt(scheduledValue, now);
  if (!schedule.ok) return { ok: false, error: schedule.error };
  return { ok: true, options: { send, scheduledAt: schedule.scheduledAt } };
}
