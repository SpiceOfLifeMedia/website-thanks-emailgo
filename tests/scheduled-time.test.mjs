import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScheduledAt } from '../src/lib/scheduled-time.ts';

const now = Date.parse('2026-11-27T12:00:00.000Z');

test('scheduled time accepts ISO timestamps and normalizes offsets to UTC', () => {
  assert.deepEqual(normalizeScheduledAt('2026-11-28T01:00:00+01:00', now), {
    ok: true,
    scheduledAt: '2026-11-28T00:00:00.000Z',
  });
});

test('scheduled time accepts relative expressions using supported units', () => {
  assert.equal(normalizeScheduledAt('in 1 min', now).scheduledAt, '2026-11-27T12:01:00.000Z');
  assert.equal(normalizeScheduledAt('in 5 minutes', now).scheduledAt, '2026-11-27T12:05:00.000Z');
  assert.equal(normalizeScheduledAt('in 2 hours', now).scheduledAt, '2026-11-27T14:00:00.000Z');
  assert.equal(normalizeScheduledAt('in 1 week', now).scheduledAt, '2026-12-04T12:00:00.000Z');
});

test('scheduled time accepts calendar expressions in UTC and named time zones', () => {
  assert.equal(normalizeScheduledAt('tomorrow at 9am', now).scheduledAt, '2026-11-28T09:00:00.000Z');
  assert.equal(normalizeScheduledAt('Friday at 3pm ET', now).scheduledAt, '2026-11-27T20:00:00.000Z');
  assert.equal(normalizeScheduledAt('Monday at 10:30am America/Los_Angeles', now).scheduledAt, '2026-11-30T18:30:00.000Z');
});

test('scheduled time rejects invalid, ambiguous and out-of-range expressions', () => {
  assert.equal(normalizeScheduledAt('next someday', now).ok, false);
  assert.equal(normalizeScheduledAt('tomorrow at 9pm Not/AZone', now).ok, false);
  assert.equal(normalizeScheduledAt('today at 8am UTC', now).ok, false);
  assert.equal(normalizeScheduledAt('in 31 days', now).ok, false);
  assert.equal(normalizeScheduledAt('in 0 minutes', now).ok, false);
});
