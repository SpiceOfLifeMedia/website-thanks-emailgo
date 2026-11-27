'use client';

import { useCallback, useEffect, useState } from 'react';
import SendThanksSegments, {
  EMPTY_FILTERS,
  toFiltersJson,
  validateSegment,
  type ActivityEvent,
  type SegmentFilters as EditorFilters,
  type SegmentRule,
  type SavedSegment,
} from './SendThanksSegments';
import styles from './segments-workspace.module.css';

type ApiSegmentFilters = {
  tags_all?: string[];
  tags_any?: string[];
  consent_status?: 'unknown' | 'opted_in';
  unsubscribed?: boolean;
  groups_match?: 'all' | 'any';
  groups?: Array<{ match: 'all' | 'any'; rules: Array<Record<string, unknown>> }>;
};

type ApiSegment = {
  id: string;
  name: string;
  filters: ApiSegmentFilters;
  contacts_count: number;
  created_at: string;
  updated_at: string;
};

type SegmentsResponse = { data: ApiSegment[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: unknown } | string };
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(typeof message === 'string' ? message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function toEditorRule(value: Record<string, unknown>): SegmentRule | null {
  if (value.type === 'tag' && (value.operator === 'has' || value.operator === 'does_not_have') && typeof value.value === 'string') {
    return { kind: 'tag', op: value.operator === 'has' ? 'has' : 'not_has', value: value.value };
  }
  if (value.type === 'consent' && (value.value === 'unknown' || value.value === 'opted_in')) {
    return { kind: 'consent', op: 'is', value: value.value === 'unknown' ? 'not_recorded' : 'opted_in' };
  }
  if (value.type === 'unsubscribed' && typeof value.value === 'boolean') {
    return { kind: 'unsubscribed', op: 'is', value: value.value };
  }
  if (value.type === 'property' && typeof value.key === 'string' && (value.value_type === 'string' || value.value_type === 'number')) {
    const operators: Record<string, string> = {
      equals: 'equals', not_equals: 'not_equals', contains: 'contains', is_set: 'is_set', is_empty: 'is_not_set',
      greater_than: 'gt', greater_than_or_equal: 'gte', less_than: 'lt', less_than_or_equal: 'lte',
    };
    const op = operators[String(value.operator)];
    if (!op) return null;
    const property = { kind: 'property' as const, key: value.key, type: value.value_type };
    return value.value_type === 'number'
      ? { ...property, type: 'number', op: op as 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_set' | 'is_not_set', value: value.value as number | undefined }
      : { ...property, type: 'string', op: op as 'equals' | 'not_equals' | 'contains' | 'is_set' | 'is_not_set', value: value.value as string | undefined };
  }
  if (value.type === 'activity' && typeof value.event === 'string' && (value.occurrence === 'occurred' || value.occurrence === 'not_occurred') && typeof value.within_days === 'number') {
    return { kind: 'activity', event: value.event.replace(/^email\./, '') as ActivityEvent, op: value.occurrence === 'occurred' ? 'happened' : 'not_happened', days: value.within_days };
  }
  return null;
}

function toEditorFilters(filters: ApiSegmentFilters): EditorFilters {
  const legacyRules: SegmentRule[] = [];
  for (const tag of filters.tags_all ?? []) legacyRules.push({ kind: 'tag', op: 'has', value: tag });
  if (filters.consent_status) legacyRules.push({ kind: 'consent', op: 'is', value: filters.consent_status === 'unknown' ? 'not_recorded' : 'opted_in' });
  if (filters.unsubscribed !== undefined) legacyRules.push({ kind: 'unsubscribed', op: 'is', value: filters.unsubscribed });

  const existingGroups: EditorFilters['groups'] = [];
  for (const group of filters.groups ?? []) {
    const rules = group.rules.map(toEditorRule);
    if (rules.some(rule => rule === null)) throw new Error('This saved segment contains a rule the editor cannot display.');
    existingGroups.push({ match: group.match, rules: rules as SegmentRule[] });
  }

  const tagsAny = filters.tags_any ?? [];
  if (existingGroups.length === 0) {
    return {
      match: 'all',
      groups: [
        ...(legacyRules.length ? [{ match: 'all' as const, rules: legacyRules }] : []),
        ...(tagsAny.length ? [{ match: 'any' as const, rules: tagsAny.map(value => ({ kind: 'tag' as const, op: 'has' as const, value })) }] : []),
      ],
    };
  }

  const groupMatch = filters.groups_match ?? 'all';
  if (groupMatch === 'all') {
    return {
      match: 'all',
      groups: [
        ...(legacyRules.length ? [{ match: 'all' as const, rules: legacyRules }] : []),
        ...(tagsAny.length ? [{ match: 'any' as const, rules: tagsAny.map(value => ({ kind: 'tag' as const, op: 'has' as const, value })) }] : []),
        ...existingGroups,
      ],
    };
  }

  const hasLegacyFilter = legacyRules.length > 0 || tagsAny.length > 0;
  if (!hasLegacyFilter) return { match: 'any', groups: existingGroups };

  const baseAlternatives = tagsAny.length
    ? tagsAny.map(tag => [...legacyRules, { kind: 'tag' as const, op: 'has' as const, value: tag }])
    : [legacyRules];
  const expanded = existingGroups.flatMap(group => {
    const terms = group.match === 'all' ? [group.rules] : group.rules.map(rule => [rule]);
    return baseAlternatives.flatMap(base => terms.map(term => ({ match: 'all' as const, rules: [...base, ...term] })));
  });
  if (expanded.length > 10 || expanded.reduce((total, group) => total + group.rules.length, 0) > 50) {
    throw new Error('This saved segment is too complex to edit safely here.');
  }
  return { match: 'any', groups: expanded };
}

function toApiRule(rule: SegmentRule): Record<string, unknown> {
  if (rule.kind === 'tag') return { type: 'tag', operator: rule.op === 'has' ? 'has' : 'does_not_have', value: rule.value };
  if (rule.kind === 'consent') return { type: 'consent', operator: 'is', value: rule.value === 'not_recorded' ? 'unknown' : 'opted_in' };
  if (rule.kind === 'unsubscribed') return { type: 'unsubscribed', value: rule.value };
  if (rule.kind === 'activity') return { type: 'activity', event: `email.${rule.event}`, occurrence: rule.op === 'happened' ? 'occurred' : 'not_occurred', within_days: rule.days };

  const propertyOperators: Record<string, string> = {
    equals: 'equals', not_equals: 'not_equals', contains: 'contains', is_set: 'is_set', is_not_set: 'is_empty',
    eq: 'equals', neq: 'not_equals', gt: 'greater_than', gte: 'greater_than_or_equal', lt: 'less_than', lte: 'less_than_or_equal',
  };
  return {
    type: 'property', key: rule.key, value_type: rule.type, operator: propertyOperators[rule.op],
    ...(['is_set', 'is_not_set'].includes(rule.op) ? {} : { value: rule.value }),
  };
}

function toApiFilters(filters: EditorFilters): ApiSegmentFilters {
  return {
    groups_match: filters.match,
    groups: toFiltersJson(filters).groups.map(group => ({ match: group.match, rules: group.rules.map(toApiRule) })),
  };
}

export function SegmentsWorkspace() {
  const [segments, setSegments] = useState<ApiSegment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<EditorFilters>(EMPTY_FILTERS);
  const [count, setCount] = useState<number | null>(null);
  const [countStatus, setCountStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(false);
  const validation = validateSegment(name, filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<SegmentsResponse>('/api/segments');
      setSegments(result.data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load segments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const preview = useCallback(async () => {
    if (validation.count > 0) {
      setCount(null);
      setCountStatus('idle');
      return;
    }
    setCountStatus('loading');
    try {
      const result = await api<{ contacts_count: number }>('/api/segments/preview', {
        method: 'POST',
        body: JSON.stringify({ filters: toApiFilters(filters) }),
      });
      setCount(result.contacts_count);
      setCountStatus('ready');
    } catch {
      setCount(null);
      setCountStatus('error');
    }
  }, [filters, validation.count]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void preview(); }, 300);
    return () => window.clearTimeout(timer);
  }, [preview]);

  function startNew() {
    setSelectedId(null);
    setName('');
    setFilters(EMPTY_FILTERS);
    setShowErrors(false);
    setError('');
    setNotice('');
  }

  function selectSegment(id: string) {
    const selected = segments.find(segment => segment.id === id);
    if (!selected) return;
    try {
      setFilters(toEditorFilters(selected.filters));
      setSelectedId(id);
      setName(selected.name);
      setShowErrors(false);
      setError('');
      setNotice('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this segment.');
    }
  }

  async function save() {
    setShowErrors(true);
    if (validation.count > 0) return;
    if (!filters.groups.some(group => group.rules.length > 0)) {
      setError('Add at least one rule before saving this segment.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const editing = selectedId !== null;
    try {
      const result = await api<ApiSegment>(editing ? `/api/segments/${encodeURIComponent(selectedId)}` : '/api/segments', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: name.trim(), filters: toApiFilters(filters) }),
      });
      setSelectedId(result.id);
      setName(result.name);
      setFilters(toEditorFilters(result.filters));
      setNotice(editing ? 'Segment updated.' : 'Segment created.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save segment.');
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/segments/${encodeURIComponent(selectedId)}`, { method: 'DELETE' });
      startNew();
      setNotice('Segment deleted.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete segment.');
    } finally {
      setSaving(false);
    }
  }

  const savedSegments: SavedSegment[] = segments.map(segment => ({
    id: segment.id,
    name: segment.name,
    contactCount: segment.contacts_count,
  }));

  return <>
    <div className={styles.actions}>
      {error && <p className={styles.message} role="alert">{error}</p>}
      <div className={styles.buttons}>
        <button type="button" onClick={() => void load()} disabled={loading || saving}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        {selectedId && <button type="button" className={styles.delete} onClick={() => void removeSelected()} disabled={saving}>Delete selected</button>}
      </div>
    </div>
    <SendThanksSegments
      savedSegments={savedSegments}
      selectedSegmentId={selectedId}
      name={name}
      filters={filters}
      count={count}
      countStatus={countStatus}
      showErrors={showErrors}
      saving={saving}
      notice={notice || null}
      layout={mobile ? 'mobile' : 'desktop'}
      onNameChange={value => { setName(value); setShowErrors(false); setError(''); setNotice(''); }}
      onFiltersChange={value => { setFilters(value); setShowErrors(false); setError(''); setNotice(''); }}
      onSelectSegment={selectSegment}
      onNewSegment={startNew}
      onSave={() => void save()}
      onRetryCount={() => void preview()}
    />
  </>;
}

export default SegmentsWorkspace;
