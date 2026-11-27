import { DEFAULT_WORKSPACE_ID } from './workspaces.ts';

export type SegmentEvent = 'email.sent' | 'email.delivered' | 'email.opened' | 'email.clicked' | 'email.bounced' | 'email.complained';
export type SegmentPropertyType = 'string' | 'number';
type StringPropertyOperator = 'equals' | 'not_equals' | 'contains' | 'is_set' | 'is_empty';
type NumberPropertyOperator = 'equals' | 'not_equals' | 'greater_than' | 'greater_than_or_equal' | 'less_than' | 'less_than_or_equal' | 'is_set' | 'is_empty';
export type SegmentCondition =
  | { type: 'property'; key: string; value_type: 'string'; operator: StringPropertyOperator; value?: string }
  | { type: 'property'; key: string; value_type: 'number'; operator: NumberPropertyOperator; value?: number }
  | { type: 'activity'; event: SegmentEvent; occurrence: 'occurred' | 'not_occurred'; within_days: number }
  | { type: 'tag'; operator: 'has' | 'does_not_have'; value: string }
  | { type: 'consent'; operator: 'is' | 'is_not'; value: 'unknown' | 'opted_in' }
  | { type: 'unsubscribed'; value: boolean };
export type SegmentConditionGroup = { match: 'all' | 'any'; rules: SegmentCondition[] };
export type SegmentFilters = {
  tags_all?: string[];
  tags_any?: string[];
  consent_status?: 'unknown' | 'opted_in';
  unsubscribed?: boolean;
  groups_match?: 'all' | 'any';
  groups?: SegmentConditionGroup[];
};

export type SegmentRow = {
  id: string;
  name: string;
  filters_json: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
};

const propertyKeyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const tagPattern = /^[A-Za-z0-9_-]{1,50}$/;
const segmentEvents = new Set<SegmentEvent>(['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained']);
const stringOperators = new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_empty']);
const numberOperators = new Set(['equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_set', 'is_empty']);
const deliveryEventTypes: Partial<Record<SegmentEvent, string>> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

function parseCondition(value: unknown): SegmentCondition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;

  if (rule.type === 'property') {
    if (typeof rule.key !== 'string' || !propertyKeyPattern.test(rule.key)) return null;
    if (rule.value_type !== 'string' && rule.value_type !== 'number') return null;
    const allowed = rule.value_type === 'string' ? stringOperators : numberOperators;
    if (typeof rule.operator !== 'string' || !allowed.has(rule.operator)) return null;
    if (rule.operator === 'is_set' || rule.operator === 'is_empty') {
      return { type: 'property', key: rule.key, value_type: rule.value_type, operator: rule.operator };
    }
    if (rule.value_type === 'string' && typeof rule.value === 'string' && rule.value.length <= 1000) {
      if (rule.operator !== 'equals' && rule.operator !== 'not_equals' && rule.operator !== 'contains') return null;
      return { type: 'property', key: rule.key, value_type: 'string', operator: rule.operator, value: rule.value };
    }
    if (rule.value_type === 'number' && typeof rule.value === 'number' && Number.isFinite(rule.value)) {
      if (!['equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal'].includes(rule.operator)) return null;
      return { type: 'property', key: rule.key, value_type: 'number', operator: rule.operator as NumberPropertyOperator, value: rule.value };
    }
    return null;
  }

  if (rule.type === 'activity') {
    if (typeof rule.event !== 'string' || !segmentEvents.has(rule.event as SegmentEvent)) return null;
    if (rule.occurrence !== 'occurred' && rule.occurrence !== 'not_occurred') return null;
    if (!Number.isInteger(rule.within_days) || (rule.within_days as number) < 1 || (rule.within_days as number) > 3650) return null;
    return { type: 'activity', event: rule.event as SegmentEvent, occurrence: rule.occurrence, within_days: rule.within_days as number };
  }

  if (rule.type === 'tag') {
    if ((rule.operator !== 'has' && rule.operator !== 'does_not_have') || typeof rule.value !== 'string' || !tagPattern.test(rule.value)) return null;
    return { type: 'tag', operator: rule.operator, value: rule.value };
  }

  if (rule.type === 'consent') {
    if ((rule.operator !== 'is' && rule.operator !== 'is_not') || (rule.value !== 'unknown' && rule.value !== 'opted_in')) return null;
    return { type: 'consent', operator: rule.operator, value: rule.value };
  }

  if (rule.type === 'unsubscribed' && typeof rule.value === 'boolean') return { type: 'unsubscribed', value: rule.value };
  return null;
}

export function parseSegmentFilters(value: unknown): { ok: true; filters: SegmentFilters } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'filters must be an object.' };
  const body = value as Record<string, unknown>;
  const tagsAll = body.tags_all === undefined ? [] : body.tags_all;
  const tagsAny = body.tags_any === undefined ? [] : body.tags_any;
  const validTags = (tags: unknown) => Array.isArray(tags) && tags.length <= 20 && tags.every((tag) => typeof tag === 'string' && tagPattern.test(tag));
  if (!validTags(tagsAll)) return { ok: false, error: 'tags_all must contain up to 20 short tag names.' };
  if (!validTags(tagsAny)) return { ok: false, error: 'tags_any must contain up to 20 short tag names.' };
  const all = [...new Set(tagsAll as string[])];
  const any = [...new Set(tagsAny as string[])];
  if (all.length !== (tagsAll as string[]).length || any.length !== (tagsAny as string[]).length) return { ok: false, error: 'Segment tag filters cannot contain duplicate values.' };
  if (all.some((tag) => any.includes(tag))) return { ok: false, error: 'A tag cannot appear in both tags_all and tags_any.' };
  if (body.consent_status !== undefined && body.consent_status !== 'unknown' && body.consent_status !== 'opted_in') return { ok: false, error: 'consent_status must be unknown or opted_in.' };
  if (body.unsubscribed !== undefined && typeof body.unsubscribed !== 'boolean') return { ok: false, error: 'unsubscribed must be a boolean.' };

  let groups: SegmentConditionGroup[] = [];
  if (body.groups_match !== undefined && body.groups_match !== 'all' && body.groups_match !== 'any') return { ok: false, error: 'groups_match must be all or any.' };
  if (body.groups_match !== undefined && (!Array.isArray(body.groups) || body.groups.length === 0)) return { ok: false, error: 'groups_match requires at least one rule group.' };
  if (body.groups !== undefined) {
    if (!Array.isArray(body.groups) || body.groups.length > 10) return { ok: false, error: 'groups must contain up to 10 rule groups.' };
    let totalRules = 0;
    for (const valueGroup of body.groups) {
      if (!valueGroup || typeof valueGroup !== 'object' || Array.isArray(valueGroup)) return { ok: false, error: 'Each rule group must be an object.' };
      const group = valueGroup as Record<string, unknown>;
      if (group.match !== 'all' && group.match !== 'any') return { ok: false, error: 'Each rule group match value must be all or any.' };
      if (!Array.isArray(group.rules) || group.rules.length < 1 || group.rules.length > 20) return { ok: false, error: 'Each rule group must contain 1 to 20 conditions.' };
      totalRules += group.rules.length;
      if (totalRules > 50) return { ok: false, error: 'A segment can contain up to 50 conditions.' };
      const rules = group.rules.map(parseCondition);
      if (rules.some((rule) => rule === null)) return { ok: false, error: 'A segment condition is invalid.' };
      groups.push({ match: group.match, rules: rules as SegmentCondition[] });
    }
  }

  if (!all.length && !any.length && body.consent_status === undefined && body.unsubscribed === undefined && groups.length === 0) {
    return { ok: false, error: 'Add a tag, consent, unsubscribe or condition rule. Empty filters would match every contact.' };
  }
  return {
    ok: true,
    filters: {
      ...(all.length ? { tags_all: all } : {}),
      ...(any.length ? { tags_any: any } : {}),
      ...(body.consent_status ? { consent_status: body.consent_status as 'unknown' | 'opted_in' } : {}),
      ...(body.unsubscribed !== undefined ? { unsubscribed: body.unsubscribed as boolean } : {}),
      ...(groups.length ? { groups_match: (body.groups_match as 'all' | 'any' | undefined) ?? 'all' } : {}),
      ...(groups.length ? { groups } : {}),
    },
  };
}

function escapeLike(value: string) {
  return value.replace(/[!%_]/g, '!$&');
}

function contactEmailMatches(alias: string, isPostgres: boolean) {
  return ['to_json', 'cc_json', 'bcc_json'].map((column) => {
    const fullColumn = `${alias}.${column}`;
    const source = isPostgres
      ? `jsonb_array_elements_text(COALESCE(${fullColumn}::jsonb, '[]'::jsonb)) AS recipient(value)`
      : `json_each(COALESCE(${fullColumn}, '[]')) AS recipient`;
    const recipientValue = isPostgres ? 'recipient.value' : 'CAST(recipient.value AS TEXT)';
    return `EXISTS (SELECT 1 FROM ${source} WHERE lower(${recipientValue})=lower(c.email))`;
  }).join(' OR ');
}

function recipientCount(alias: string, isPostgres: boolean) {
  const length = (column: string) => isPostgres
    ? `jsonb_array_length(COALESCE(${alias}.${column}::jsonb, '[]'::jsonb))`
    : `json_array_length(COALESCE(${alias}.${column}, '[]'))`;
  return `${length('to_json')} + ${length('cc_json')} + ${length('bcc_json')}`;
}

function propertyCondition(rule: Extract<SegmentCondition, { type: 'property' }>, isPostgres: boolean) {
  const typeExpression = isPostgres
    ? `jsonb_typeof(c.properties_json::jsonb -> ?)`
    : `json_type(c.properties_json, '$."' || ? || '"')`;
  const textExpression = isPostgres
    ? `(c.properties_json::jsonb ->> ?)`
    : `json_extract(c.properties_json, '$."' || ? || '"')`;
  const valueExpression = rule.value_type === 'number'
    ? isPostgres ? `CAST(${textExpression} AS DOUBLE PRECISION)` : `CAST(${textExpression} AS REAL)`
    : textExpression;
  const presentType = rule.value_type === 'number' ? (isPostgres ? 'number' : "('integer','real')") : (isPostgres ? 'string' : "'text'");
  const typeCheck = rule.value_type === 'number'
    ? `${typeExpression} IN ${isPostgres ? "('number')" : presentType}`
    : `${typeExpression}=${isPostgres ? "'string'" : presentType}`;

  if (rule.operator === 'is_set' || rule.operator === 'is_empty') {
    const missing = rule.value_type === 'number'
      ? isPostgres ? `(${typeExpression} IS DISTINCT FROM 'number')` : `(${typeExpression} IS NULL OR ${typeExpression} NOT IN ('integer','real'))`
      : isPostgres ? `(${typeExpression} IS DISTINCT FROM 'string')` : `(${typeExpression} IS NULL OR ${typeExpression}<>'text')`;
    const emptyString = rule.value_type === 'string'
      ? `(${typeCheck} AND ${textExpression}='')`
      : '0=1';
    if (rule.operator === 'is_set') return { sql: `(${typeCheck})`, params: [rule.key] };
    if (rule.value_type === 'number') return { sql: missing, params: isPostgres ? [rule.key] : [rule.key, rule.key] };
    return { sql: `(${missing} OR ${emptyString})`, params: isPostgres ? [rule.key, rule.key, rule.key] : [rule.key, rule.key, rule.key, rule.key] };
  }

  const comparison = rule.operator === 'equals' ? '='
    : rule.operator === 'not_equals' ? '<>'
      : rule.operator === 'contains' ? 'LIKE'
        : rule.operator === 'greater_than' ? '>'
          : rule.operator === 'greater_than_or_equal' ? '>='
            : rule.operator === 'less_than' ? '<' : '<=';
  let compareValue: string | number = rule.value as string | number;
  if (rule.operator === 'contains') compareValue = `%${escapeLike(compareValue as string)}%`;
  const operator = rule.operator === 'contains' ? "LIKE ? ESCAPE '!'" : `${comparison} ?`;
  return {
    sql: `(${typeCheck} AND ${valueExpression} ${operator})`,
    params: [rule.key, rule.key, compareValue],
  };
}

function activityCondition(rule: Extract<SegmentCondition, { type: 'activity' }>, isPostgres: boolean, nowMs: number, workspaceId: string) {
  const cutoff = new Date(nowMs - rule.within_days * 24 * 60 * 60 * 1000).toISOString();
  let existsSql: string;
  let params: Array<string | number | null>;
  if (rule.event === 'email.sent') {
    const eventRecipientMatch = contactEmailMatches('e', isPostgres);
    const fallbackRecipientMatch = contactEmailMatches('e', isPostgres);
    existsSql = `(EXISTS (SELECT 1 FROM email_events ev JOIN emails e ON e.id=ev.email_id JOIN api_keys ak ON ak.id=e.api_key_id WHERE ak.workspace_id=? AND ev.type='email.sent' AND ev.created_at>=? AND (${eventRecipientMatch}))
      OR EXISTS (SELECT 1 FROM emails e JOIN api_keys ak ON ak.id=e.api_key_id WHERE ak.workspace_id=? AND e.status IN ('sent','deferred','delivered','bounced','complained') AND e.created_at>=?
        AND NOT EXISTS (SELECT 1 FROM email_events ev WHERE ev.email_id=e.id AND ev.type='email.sent') AND (${fallbackRecipientMatch})))`;
    params = [workspaceId, cutoff, workspaceId, cutoff];
  } else if (rule.event === 'email.opened' || rule.event === 'email.clicked') {
    const recipientMatch = contactEmailMatches('e', isPostgres);
    existsSql = `EXISTS (SELECT 1 FROM email_events ev JOIN emails e ON e.id=ev.email_id JOIN api_keys ak ON ak.id=e.api_key_id WHERE ak.workspace_id=? AND ev.type=? AND ev.created_at>=? AND (${recipientMatch}) AND (${recipientCount('e', isPostgres)})=1)`;
    params = [workspaceId, rule.event, cutoff];
  } else {
    const eventType = deliveryEventTypes[rule.event];
    if (!eventType) return { sql: '0=1', params: [] };
    existsSql = `EXISTS (SELECT 1 FROM delivery_events d JOIN emails e ON e.id=d.email_id JOIN api_keys ak ON ak.id=e.api_key_id WHERE ak.workspace_id=? AND lower(d.recipient)=lower(c.email) AND d.event_type=? AND d.created_at>=?)`;
    params = [workspaceId, eventType, cutoff];
  }
  const sql = rule.occurrence === 'occurred' ? existsSql : `NOT (${existsSql})`;
  return { sql, params };
}

function conditionWhere(rule: SegmentCondition, isPostgres: boolean, nowMs: number, workspaceId: string) {
  if (rule.type === 'property') return propertyCondition(rule, isPostgres);
  if (rule.type === 'activity') return activityCondition(rule, isPostgres, nowMs, workspaceId);
  if (rule.type === 'tag') {
    const tag = `c.tags_json LIKE ? ESCAPE '!'`;
    return { sql: rule.operator === 'has' ? tag : `NOT (${tag})`, params: [`%${escapeLike(JSON.stringify(rule.value))}%`] };
  }
  if (rule.type === 'consent') return { sql: `c.consent_status${rule.operator === 'is' ? '=' : '<>'}?`, params: [rule.value] };
  return { sql: rule.value ? 'c.unsubscribed_at IS NOT NULL' : 'c.unsubscribed_at IS NULL', params: [] };
}

export function segmentWhere(filters: SegmentFilters, segmentId?: string, isPostgres = Boolean(process.env.DATABASE_URL), nowMs = Date.now(), workspaceId = DEFAULT_WORKSPACE_ID) {
  const clauses: string[] = ['c.workspace_id=?'];
  const params: Array<string | number | null> = [workspaceId];
  for (const tag of filters.tags_all ?? []) {
    clauses.push("c.tags_json LIKE ? ESCAPE '!' ");
    params.push(`%${escapeLike(JSON.stringify(tag))}%`);
  }
  if (filters.tags_any?.length) {
    clauses.push(`(${filters.tags_any.map(() => "c.tags_json LIKE ? ESCAPE '!'").join(' OR ')})`);
    params.push(...filters.tags_any.map((tag) => `%${escapeLike(JSON.stringify(tag))}%`));
  }
  if (filters.consent_status !== undefined) {
    clauses.push('c.consent_status=?');
    params.push(filters.consent_status);
  }
  if (filters.unsubscribed !== undefined) clauses.push(filters.unsubscribed ? 'c.unsubscribed_at IS NOT NULL' : 'c.unsubscribed_at IS NULL');
  const compiledGroups: Array<{ sql: string; params: Array<string | number | null> }> = [];
  for (const group of filters.groups ?? []) {
    const compiled = group.rules.map((rule) => conditionWhere(rule, isPostgres, nowMs, workspaceId));
    compiledGroups.push({
      sql: `(${compiled.map((item) => item.sql).join(group.match === 'all' ? ' AND ' : ' OR ')})`,
      params: compiled.flatMap((item) => item.params),
    });
  }
  if (compiledGroups.length) {
    clauses.push(`(${compiledGroups.map((group) => group.sql).join(filters.groups_match === 'any' ? ' OR ' : ' AND ')})`);
    params.push(...compiledGroups.flatMap((group) => group.params));
  }
  const filterWhere = clauses.join(' AND ');
  if (!segmentId) return { where: filterWhere, params };
  const membership = 'EXISTS (SELECT 1 FROM segment_contacts sc WHERE sc.segment_id=? AND sc.contact_id=c.id)';
  return {
    where: `((${filterWhere ? `(${filterWhere}) OR ` : ''}${membership}) AND NOT EXISTS (SELECT 1 FROM segment_contact_exclusions sx WHERE sx.segment_id=? AND sx.contact_id=c.id))`,
    params: [...params, segmentId, segmentId],
  };
}

export async function countSegment(filters: SegmentFilters, segmentId?: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  const { queryOne } = await import('@/lib/database');
  const { where, params } = segmentWhere(filters, segmentId, undefined, undefined, workspaceId);
  const result = await queryOne<{ count: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS count FROM contacts c WHERE ${where}`, params);
  return Number(result?.count ?? 0);
}

export async function toSegment(row: SegmentRow, workspaceId = row.workspace_id ?? DEFAULT_WORKSPACE_ID) {
  let filters: SegmentFilters = {};
  try { filters = JSON.parse(row.filters_json) as SegmentFilters; } catch {}
  return { id: row.id, object: 'segment', name: row.name, filters, contacts_count: await countSegment(filters, row.id, workspaceId), created_at: row.created_at, updated_at: row.updated_at };
}
