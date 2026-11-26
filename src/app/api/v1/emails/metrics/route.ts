import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const availableMetrics = ['received', 'sent', 'failed', 'suppressed', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'opened', 'unique_opened', 'clicked', 'unique_clicked'] as const;
const unavailableMetrics = ['bounced_transient', 'bounced_permanent', 'bounced_undetermined', 'unsubscribed', 'delivery_rate', 'open_rate', 'click_rate', 'bounce_rate', 'complaint_rate', 'unsubscribe_rate'] as const;
const dimensions = new Set(['period', 'domain', 'email', 'broadcast']);
const granularities = new Set(['hourly', 'daily', 'weekly', 'monthly']);
const metricSet = new Set<string>(availableMetrics);
const unavailableSet = new Set<string>(unavailableMetrics);
const MAX_METRIC_ROWS = 50_000;

type DomainRow = { id: string; domain: string };
type EmailRow = { id: string; from_address: string; status: string; created_at: string; broadcast_id: string | null };
type MetricRow = { email_id: string; from_address: string; broadcast_id: string | null; occurred_at: string };
type DeliveryMetricRow = { id: string; email_id: string; event_type: string; created_at: string; from_address: string; broadcast_id: string | null };

function errorResponse(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, ...details } }, { status });
}

function parseList(params: URLSearchParams, key: string) {
  return params.getAll(key).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
}

function parseRange(params: URLSearchParams) {
  const now = Date.now();
  const endValue = params.get('end_date');
  const startValue = params.get('start_date');
  const dateOnly = (value: string | null) => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parse = (value: string) => {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
  };
  const endParsed = endValue === null ? now : parse(endValue);
  if (endParsed === undefined) return { error: 'end_date must be a valid ISO 8601 date or datetime.' } as const;
  const endExclusive = Math.min(dateOnly(endValue) ? Date.parse(`${endValue}T00:00:00.000Z`) + 86_400_000 : endParsed + 1, now + 1);
  const startDefault = Date.UTC(new Date(Math.min(endExclusive, now)).getUTCFullYear(), new Date(Math.min(endExclusive, now)).getUTCMonth(), new Date(Math.min(endExclusive, now)).getUTCDate()) - 6 * 86_400_000;
  const startParsed = startValue === null ? startDefault : parse(startValue);
  if (startParsed === undefined) return { error: 'start_date must be a valid ISO 8601 date or datetime.' } as const;
  const start = dateOnly(startValue) ? Date.parse(`${startValue}T00:00:00.000Z`) : startParsed;
  const endInclusive = dateOnly(endValue) ? endExclusive - 1 : endParsed;
  if (start > endInclusive || start >= endExclusive) return { error: 'start_date must be on or before end_date.' } as const;
  return { start, endExclusive, startDate: new Date(start).toISOString(), endDate: new Date(Math.min(endExclusive, now)).toISOString() } as const;
}

function timezoneOffsetMinutes(time: number, timeZone: string) {
  const label = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(time)).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT(?:(\+|-)(\d{1,2})(?::?(\d{2}))?)?$/.exec(label);
  if (!match || !match[1]) return 0;
  const amount = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -amount : amount;
}

function localPeriod(time: number, timeZone: string, granularity: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  const hour = Number(value.hour);
  let periodKey: string;
  let startParts: [number, number, number, number];
  if (granularity === 'hourly') {
    periodKey = `${value.year}-${value.month}-${value.day}T${value.hour}@${timezoneOffsetMinutes(time, timeZone)}`;
    startParts = [year, month, day, hour];
  } else if (granularity === 'weekly') {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekYear = date.getUTCFullYear();
    const weekMonth = date.getUTCMonth() + 1;
    const weekDay = date.getUTCDate();
    periodKey = `${weekYear}-${String(weekMonth).padStart(2, '0')}-${String(weekDay).padStart(2, '0')}`;
    startParts = [weekYear, weekMonth, weekDay, 0];
  } else if (granularity === 'monthly') {
    periodKey = `${value.year}-${value.month}`;
    startParts = [year, month, 1, 0];
  } else {
    periodKey = `${value.year}-${value.month}-${value.day}`;
    startParts = [year, month, day, 0];
  }
  const [startYear, startMonth, startDay, startHour] = startParts;
  const wallClock = Date.UTC(startYear, startMonth - 1, startDay, startHour);
  let utcStart = wallClock - timezoneOffsetMinutes(time, timeZone) * 60_000;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = wallClock - timezoneOffsetMinutes(utcStart, timeZone) * 60_000;
    if (corrected === utcStart) break;
    utcStart = corrected;
  }
  return { key: periodKey, value: new Date(utcStart).toISOString() };
}

function parseDomain(email: string, domains: DomainRow[]) {
  const host = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const domain = domains.filter((item) => host === item.domain.toLowerCase() || host.endsWith(`.${item.domain.toLowerCase()}`)).sort((a, b) => b.domain.length - a.domain.length)[0];
  return domain ? { id: domain.id, name: domain.domain } : { id: null, name: host || null };
}

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const params = new URL(request.url).searchParams;
  const range = parseRange(params);
  if ('error' in range && range.error) return errorResponse(range.error, 400);
  const requestedMetrics = parseList(params, 'metrics');
  const metrics = requestedMetrics.length ? [...new Set(requestedMetrics)] : [...availableMetrics];
  const unsupported = metrics.filter((metric) => !metricSet.has(metric));
  if (unsupported.length) {
    const providerUnavailable = unsupported.filter((metric) => unavailableSet.has(metric));
    const unknown = unsupported.filter((metric) => !unavailableSet.has(metric));
    return errorResponse(
      providerUnavailable.length ? 'Some requested metrics are not available because the configured SMTP relay does not report recipient delivery outcomes.' : `Unknown metric: ${unknown.join(', ')}.`,
      providerUnavailable.length ? 422 : 400,
      { unsupported_metrics: unsupported, available_metrics: availableMetrics, unavailable_metrics: unavailableMetrics },
    );
  }
  const requestedDimensions = parseList(params, 'dimensions');
  const selectedDimensions = [...new Set(requestedDimensions)];
  const invalidDimensions = selectedDimensions.filter((dimension) => !dimensions.has(dimension));
  if (invalidDimensions.length) return errorResponse(`Unknown dimension: ${invalidDimensions.join(', ')}.`, 400);
  if (selectedDimensions.includes('email') && selectedDimensions.includes('broadcast')) return errorResponse('The email and broadcast dimensions cannot be combined.', 400);
  const granularity = params.get('granularity') ?? 'daily';
  if (!granularities.has(granularity)) return errorResponse('granularity must be hourly, daily, weekly or monthly.', 400);
  const timeZone = params.get('timezone') ?? 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { return errorResponse('timezone must be a valid IANA time zone.', 400); }
  if (selectedDimensions.includes('period')) {
    const elapsed = range.endExclusive - range.start;
    const divisor = granularity === 'hourly' ? 3_600_000 : granularity === 'daily' ? 86_400_000 : granularity === 'weekly' ? 604_800_000 : 2_629_746_000;
    if (elapsed / divisor > 10_000) return errorResponse('The selected date range exceeds 10,000 periods at this granularity.', 400);
  }
  const domainIds = parseList(params, 'domain_id');
  const emailIds = parseList(params, 'email_id');
  const broadcastIds = parseList(params, 'broadcast_id');
  if (domainIds.length > 100 || emailIds.length > 100 || broadcastIds.length > 100) return errorResponse('Each ID filter may contain up to 100 values.', 400);
  if (emailIds.length && (selectedDimensions.includes('broadcast') || broadcastIds.length)) return errorResponse('email_id cannot be combined with a broadcast dimension or broadcast_id filter.', 400);
  if (broadcastIds.length && selectedDimensions.includes('email')) return errorResponse('broadcast_id cannot be combined with the email dimension.', 400);
  const start = range.start;
  const end = range.endExclusive;
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const emailWhere = ['api_key_id=?', 'created_at>=?', 'created_at<?'];
  const emailParams: Array<string | number> = [key.id, startIso, endIso];
  if (emailIds.length) {
    emailWhere.push(`id IN (${emailIds.map(() => '?').join(',')})`);
    emailParams.push(...emailIds);
  }
  if (broadcastIds.length) {
    emailWhere.push(`broadcast_id IN (${broadcastIds.map(() => '?').join(',')})`);
    emailParams.push(...broadcastIds);
  }
  const emailRows = (await query<EmailRow>(`SELECT id,from_address,status,created_at,broadcast_id FROM emails WHERE ${emailWhere.join(' AND ')} ORDER BY created_at,id LIMIT ?`, [...emailParams, MAX_METRIC_ROWS + 1])).rows;
  if (emailRows.length > MAX_METRIC_ROWS) return errorResponse('The selected range contains too many email records for one metrics request. Narrow the date range or ID filters.', 413, { max_records: MAX_METRIC_ROWS });

  const eventWhere = ['e.api_key_id=?', 'ee.created_at>=?', 'ee.created_at<?', "ee.type IN ('email.opened','email.clicked')"];
  const eventParams: Array<string | number> = [key.id, startIso, endIso];
  if (emailIds.length) {
    eventWhere.push(`e.id IN (${emailIds.map(() => '?').join(',')})`);
    eventParams.push(...emailIds);
  }
  if (broadcastIds.length) {
    eventWhere.push(`e.broadcast_id IN (${broadcastIds.map(() => '?').join(',')})`);
    eventParams.push(...broadcastIds);
  }
  const eventRows = (await query<{ id: string; email_id: string; type: string; created_at: string; from_address: string; broadcast_id: string | null }>(
    `SELECT ee.id,ee.email_id,ee.type,ee.created_at,e.from_address,e.broadcast_id FROM email_events ee JOIN emails e ON e.id=ee.email_id
      WHERE ${eventWhere.join(' AND ')} ORDER BY ee.created_at,ee.id LIMIT ?`,
    [...eventParams, MAX_METRIC_ROWS + 1],
  )).rows;
  if (eventRows.length > MAX_METRIC_ROWS) return errorResponse('The selected range contains too many tracking events for one metrics request. Narrow the date range or ID filters.', 413, { max_records: MAX_METRIC_ROWS });
  const deliveryWhere = ['e.api_key_id=?', 'de.created_at>=?', 'de.created_at<?'];
  const deliveryParams: Array<string | number> = [key.id, startIso, endIso];
  if (emailIds.length) {
    deliveryWhere.push(`e.id IN (${emailIds.map(() => '?').join(',')})`);
    deliveryParams.push(...emailIds);
  }
  if (broadcastIds.length) {
    deliveryWhere.push(`e.broadcast_id IN (${broadcastIds.map(() => '?').join(',')})`);
    deliveryParams.push(...broadcastIds);
  }
  const deliveryRows = (await query<DeliveryMetricRow>(
    `SELECT de.id,de.email_id,de.event_type,de.created_at,e.from_address,e.broadcast_id FROM delivery_events de
      JOIN emails e ON e.id=de.email_id WHERE ${deliveryWhere.join(' AND ')} ORDER BY de.created_at,de.id LIMIT ?`,
    [...deliveryParams, MAX_METRIC_ROWS + 1],
  )).rows;
  if (deliveryRows.length > MAX_METRIC_ROWS) return errorResponse('The selected range contains too many delivery events for one metrics request. Narrow the date range or ID filters.', 413, { max_records: MAX_METRIC_ROWS });
  const domains = (await query<DomainRow>('SELECT id,domain FROM domains')).rows;
  const emailDomain = new Map<string, { id: string | null; name: string | null }>();
  const domainFor = (email: string) => {
    let value = emailDomain.get(email);
    if (!value) { value = parseDomain(email, domains); emailDomain.set(email, value); }
    return value;
  };
  const broadcastNames = new Map((await query<{ id: string; name: string }>('SELECT id,name FROM broadcasts WHERE api_key_id=?', [key.id])).rows.map((broadcast) => [broadcast.id, broadcast.name]));
  const domainFilter = domainIds.length ? new Set(domainIds) : undefined;
  const emailFilter = emailIds.length ? new Set(emailIds) : undefined;
  const broadcastFilter = broadcastIds.length ? new Set(broadcastIds) : undefined;
  const aggregate = new Map<string, { dimensions: Record<string, unknown>; values: Record<string, number>; unique: Record<string, Set<string>> }>();
  const groupFor = (emailId: string, from: string, broadcastId: string | null, occurredAt: string) => {
    const domain = domainFor(from);
    if (domainFilter && (!domain.id || !domainFilter.has(domain.id))) return undefined;
    if (emailFilter && !emailFilter.has(emailId)) return undefined;
    if (broadcastFilter && (!broadcastId || !broadcastFilter.has(broadcastId))) return undefined;
    const output: Record<string, unknown> = {};
    let periodKey = '';
    if (selectedDimensions.includes('period')) {
      const period = localPeriod(Date.parse(occurredAt), timeZone, granularity);
      output.period = period.value;
      periodKey = period.key;
    }
    if (selectedDimensions.includes('domain')) { output.domain_id = domain.id; output.domain_name = domain.name; }
    if (selectedDimensions.includes('email')) output.email_id = emailId;
    if (selectedDimensions.includes('broadcast')) { output.broadcast_id = broadcastId; output.broadcast_name = broadcastId ? broadcastNames.get(broadcastId) ?? null : null; }
    const key = JSON.stringify([periodKey, ...selectedDimensions.map((dimension) => output[`${dimension}_id`] ?? output[dimension] ?? '')]);
    let group = aggregate.get(key);
    if (!group) { group = { dimensions: output, values: Object.fromEntries(metrics.map((metric) => [metric, 0])), unique: {} }; aggregate.set(key, group); }
    return group;
  };
  for (const email of emailRows) {
    const group = groupFor(email.id, email.from_address, email.broadcast_id, email.created_at);
    if (!group) continue;
    if (metrics.includes('received')) group.values.received += 1;
    if (['sent', 'deferred', 'delivered', 'bounced', 'complained'].includes(email.status) && metrics.includes('sent')) group.values.sent += 1;
    if (email.status === 'failed' && metrics.includes('failed')) group.values.failed += 1;
    if (email.status === 'suppressed' && metrics.includes('suppressed')) group.values.suppressed += 1;
  }
  for (const event of eventRows) {
    const group = groupFor(event.email_id, event.from_address, event.broadcast_id, event.created_at);
    if (!group) continue;
    const metric = event.type === 'email.opened' ? 'opened' : 'clicked';
    const uniqueMetric = event.type === 'email.opened' ? 'unique_opened' : 'unique_clicked';
    if (metrics.includes(metric)) group.values[metric] += 1;
    if (metrics.includes(uniqueMetric)) {
      const seen = group.unique[uniqueMetric] ??= new Set<string>();
      if (!seen.has(event.email_id)) { seen.add(event.email_id); group.values[uniqueMetric] += 1; }
    }
  }
  for (const event of deliveryRows) {
    const group = groupFor(event.email_id, event.from_address, event.broadcast_id, event.created_at);
    if (!group) continue;
    const metric = event.event_type === 'delivered' ? 'delivered'
      : event.event_type === 'deferred' ? 'delivery_delayed'
        : event.event_type === 'bounced' ? 'bounced'
          : event.event_type === 'complained' ? 'complained' : null;
    if (metric && metrics.includes(metric as typeof metrics[number])) group.values[metric] += 1;
  }
  const groupedData = [...aggregate.values()].map((group) => ({ ...group.dimensions, ...group.values }));
  groupedData.sort((left, right) => {
    if (selectedDimensions.includes('period')) return String(left.period).localeCompare(String(right.period)) || JSON.stringify(left).localeCompare(JSON.stringify(right));
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
  const totals = Object.fromEntries(metrics.map((metric) => [metric, groupedData.reduce((total, row) => total + Number(row[metric] ?? 0), 0)]));
  return NextResponse.json({
    object: 'metrics',
    start_date: range.startDate,
    end_date: range.endDate,
    metrics,
    dimensions: selectedDimensions,
    granularity,
    totals,
    ...(selectedDimensions.length ? { data: groupedData } : {}),
    unavailable_metrics: unavailableMetrics,
    measurement_notes: { sent: 'Counts messages accepted by the configured SMTP relay; this is not recipient-server delivery confirmation.', delivered: 'Counts recipient delivery events when signed delivery notifications are configured. Delivery metrics count recipients, while sent counts messages.' },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
