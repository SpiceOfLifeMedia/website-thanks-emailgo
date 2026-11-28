const secondMs = 1_000;
const minuteMs = 60 * secondMs;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const maxScheduleMs = 30 * dayMs;

const invalidScheduleMessage = 'scheduled_at must be an ISO 8601 timestamp or a supported natural time such as "in 5 minutes", "tomorrow at 9am", or "Friday at 3pm ET".';
const relativeSchedulePattern = /^in\s+(\d+(?:\.\d+)?)\s*([a-z]+)$/i;
const calendarSchedulePattern = /^(today|tomorrow|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+([a-z0-9_+/-]+))?$/i;

const relativeUnits = new Map<string, number>([
  ['s', secondMs], ['sec', secondMs], ['secs', secondMs], ['second', secondMs], ['seconds', secondMs],
  ['m', minuteMs], ['min', minuteMs], ['mins', minuteMs], ['minute', minuteMs], ['minutes', minuteMs],
  ['h', hourMs], ['hr', hourMs], ['hrs', hourMs], ['hour', hourMs], ['hours', hourMs],
  ['d', dayMs], ['day', dayMs], ['days', dayMs],
  ['w', 7 * dayMs], ['wk', 7 * dayMs], ['wks', 7 * dayMs], ['week', 7 * dayMs], ['weeks', 7 * dayMs],
]);

const weekdayNumbers = new Map<string, number>([
  ['sun', 0], ['sunday', 0], ['mon', 1], ['monday', 1], ['tue', 2], ['tues', 2], ['tuesday', 2],
  ['wed', 3], ['wednesday', 3], ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4],
  ['fri', 5], ['friday', 5], ['sat', 6], ['saturday', 6],
]);

const timezoneAliases = new Map<string, string>([
  ['utc', 'UTC'], ['gmt', 'UTC'],
  ['et', 'America/New_York'], ['est', 'America/New_York'], ['edt', 'America/New_York'],
  ['ct', 'America/Chicago'], ['cst', 'America/Chicago'], ['cdt', 'America/Chicago'],
  ['mt', 'America/Denver'], ['mst', 'America/Denver'], ['mdt', 'America/Denver'],
  ['pt', 'America/Los_Angeles'], ['pst', 'America/Los_Angeles'], ['pdt', 'America/Los_Angeles'],
]);

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
type ScheduleResult = { ok: true; scheduledAt: string } | { ok: false; error: string };

function calendarParts(timestamp: number, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = weekdayNumbers.get(values.weekday?.toLowerCase() ?? '');
  if (weekday === undefined) throw new RangeError('Unsupported weekday.');
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday,
  };
}

function timezoneName(value: string | undefined) {
  if (!value) return 'UTC';
  return timezoneAliases.get(value.toLowerCase()) ?? value;
}

function timestampForCalendarTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const wantedWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wantedWallClock;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = calendarParts(guess, timeZone);
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const adjustment = wantedWallClock - observedWallClock;
    if (adjustment === 0) break;
    guess += adjustment;
  }

  const resolved = calendarParts(guess, timeZone);
  if (resolved.year !== year || resolved.month !== month || resolved.day !== day || resolved.hour !== hour || resolved.minute !== minute) return null;
  return guess;
}

function parseRelativeTime(input: string, now: number) {
  const match = relativeSchedulePattern.exec(input);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = relativeUnits.get(match[2].toLowerCase());
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  const timestamp = now + Math.round(amount * unit);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseCalendarTime(input: string, now: number) {
  const match = calendarSchedulePattern.exec(input);
  if (!match) return null;

  const [, dayName, rawHour, rawMinute = '0', meridian, rawTimeZone] = match;
  const hourValue = Number(rawHour);
  const minute = Number(rawMinute);
  if (minute > 59) return null;

  let hour = hourValue;
  if (meridian) {
    if (hourValue < 1 || hourValue > 12) return null;
    hour = hourValue % 12 + (meridian.toLowerCase() === 'pm' ? 12 : 0);
  } else if (hourValue > 23) {
    return null;
  }

  const timeZone = timezoneName(rawTimeZone);
  const current = calendarParts(now, timeZone);
  const normalizedDay = dayName.toLowerCase();
  let daysAhead = 0;
  if (normalizedDay === 'tomorrow') {
    daysAhead = 1;
  } else if (normalizedDay !== 'today') {
    const targetWeekday = weekdayNumbers.get(normalizedDay);
    if (targetWeekday === undefined) return null;
    daysAhead = (targetWeekday - current.weekday + 7) % 7;
  }

  const targetDate = new Date(Date.UTC(current.year, current.month - 1, current.day + daysAhead));
  let timestamp = timestampForCalendarTime(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, targetDate.getUTCDate(), hour, minute, timeZone);
  if (timestamp === null) return null;

  if (normalizedDay !== 'today' && normalizedDay !== 'tomorrow' && daysAhead === 0 && timestamp <= now) {
    const nextWeek = new Date(Date.UTC(current.year, current.month - 1, current.day + 7));
    timestamp = timestampForCalendarTime(nextWeek.getUTCFullYear(), nextWeek.getUTCMonth() + 1, nextWeek.getUTCDate(), hour, minute, timeZone);
  }
  return timestamp;
}

export function normalizeScheduledAt(value: unknown, now = Date.now()): ScheduleResult {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: invalidScheduleMessage };
  const input = value.trim();
  let timestamp: number | null = null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(input) && Number.isFinite(Date.parse(input))) {
    timestamp = Date.parse(input);
  } else {
    try {
      timestamp = parseRelativeTime(input, now) ?? parseCalendarTime(input, now);
    } catch {
      timestamp = null;
    }
  }

  if (timestamp === null || !Number.isFinite(timestamp)) return { ok: false, error: invalidScheduleMessage };
  if (timestamp <= now) return { ok: false, error: 'scheduled_at must be in the future.' };
  if (timestamp > now + maxScheduleMs) return { ok: false, error: 'scheduled_at cannot be more than 30 days in the future.' };
  return { ok: true, scheduledAt: new Date(timestamp).toISOString() };
}
