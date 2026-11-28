'use client';

import { useId } from 'react';
import styles from './send-thanks-segments.module.css';

/* ---------- JSON filters model ---------- */
export type Match = 'all' | 'any';
export type StringOp = 'equals' | 'not_equals' | 'contains' | 'is_set' | 'is_not_set';
export type NumberOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_set' | 'is_not_set';
export type ActivityEvent = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';
export type TagRule = { kind: 'tag'; op: 'has' | 'not_has'; value: string };
export type ConsentRule = { kind: 'consent'; op: 'is'; value: 'opted_in' | 'not_recorded' };
export type UnsubscribedRule = { kind: 'unsubscribed'; op: 'is'; value: boolean };
export type PropertyRule =
  | { kind: 'property'; key: string; type: 'string'; op: StringOp; value?: string }
  | { kind: 'property'; key: string; type: 'number'; op: NumberOp; value?: number | string };
export type ActivityRule = { kind: 'activity'; event: ActivityEvent; op: 'happened' | 'not_happened'; days: number };
export type SegmentRule = TagRule | ConsentRule | UnsubscribedRule | PropertyRule | ActivityRule;
export interface SegmentGroup { match: Match; rules: SegmentRule[] }
export interface SegmentFilters { match: Match; groups: SegmentGroup[] }
export interface SavedSegment { id: string; name: string; contactCount: number | null }

export const DAYS_MIN = 1;
export const DAYS_MAX = 365;
export const EMPTY_FILTERS: SegmentFilters = { match: 'all', groups: [] };

const STR_OPS: [StringOp, string][] = [['equals', 'is'], ['not_equals', 'is not'], ['contains', 'contains'], ['is_set', 'has any value'], ['is_not_set', 'is empty']];
const NUM_OPS: [NumberOp, string][] = [['eq', '='], ['neq', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['is_set', 'has any value'], ['is_not_set', 'is empty']];
const EVENT_LABEL: Record<ActivityEvent, [string, string]> = {
  sent: ['was sent an email', 'was not sent an email'], delivered: ['had an email delivered', 'had no email delivered'],
  opened: ['opened an email', 'did not open an email'], clicked: ['clicked in an email', 'did not click in an email'],
  bounced: ['bounced', 'did not bounce'], complained: ['complained', 'did not complain'],
};
const NO_VALUE = new Set(['is_set', 'is_not_set']);

export function newRule(kind: SegmentRule['kind']): SegmentRule {
  switch (kind) {
    case 'tag': return { kind, op: 'has', value: '' };
    case 'consent': return { kind, op: 'is', value: 'opted_in' };
    case 'unsubscribed': return { kind, op: 'is', value: false };
    case 'property': return { kind, key: '', type: 'string', op: 'equals', value: '' };
    case 'activity': return { kind, event: 'opened', op: 'happened', days: 30 };
  }
}

/** '' when the rule is complete and valid. */
export function validateRule(r: SegmentRule): string {
  if (r.kind === 'tag' && !r.value.trim()) return 'Enter a tag name.';
  if (r.kind === 'property') {
    if (!r.key.trim()) return 'Enter a property name.';
    if (!NO_VALUE.has(r.op)) {
      if (r.value === undefined || String(r.value).trim() === '') return 'Enter a value to compare with.';
      if (r.type === 'number' && !Number.isFinite(Number(r.value))) return 'Use a number, like 3 or 12.5.';
    }
  }
  if (r.kind === 'activity' && (!Number.isInteger(r.days) || r.days < DAYS_MIN || r.days > DAYS_MAX)) return `Use a whole number of days from ${DAYS_MIN} to ${DAYS_MAX}.`;
  return '';
}

/** Validates the name and every rule. Returns { name?, rules: Map<"g:r", message> } */
export function validateSegment(name: string, f: SegmentFilters) {
  const rules = new Map<string, string>();
  f.groups.forEach((g, gi) => g.rules.forEach((r, ri) => { const e = validateRule(r); if (e) rules.set(`${gi}:${ri}`, e); }));
  return { name: name.trim() ? '' : 'Give the segment a name.', rules, count: rules.size + (name.trim() ? 0 : 1) };
}

/** Normalises for saving: trims strings, numbers as numbers, drops values for is_set/is_not_set, removes empty groups. */
export function toFiltersJson(f: SegmentFilters): SegmentFilters {
  return {
    match: f.match,
    groups: f.groups.filter(g => g.rules.length).map(g => ({
      match: g.match,
      rules: g.rules.map(r => {
        if (r.kind === 'tag') return { ...r, value: r.value.trim() };
        if (r.kind === 'property') {
          const base = { kind: 'property' as const, key: r.key.trim(), type: r.type, op: r.op };
          if (NO_VALUE.has(r.op)) return base as PropertyRule;
          return { ...base, value: r.type === 'number' ? Number(r.value) : String(r.value ?? '').trim() } as PropertyRule;
        }
        return r;
      }),
    })),
  };
}

export function describeRule(r: SegmentRule): string {
  switch (r.kind) {
    case 'tag': return `${r.op === 'has' ? 'has' : 'doesn’t have'} the tag “${r.value || '…'}”`;
    case 'consent': return r.value === 'opted_in' ? 'has opted in' : 'has no consent recorded';
    case 'unsubscribed': return r.value ? 'is unsubscribed' : 'is not unsubscribed';
    case 'property': {
      const label = (r.type === 'number' ? NUM_OPS : STR_OPS).find(o => o[0] === r.op)?.[1] ?? r.op;
      if (NO_VALUE.has(r.op)) return `${r.key || '…'} ${label}`;
      const v = r.value === undefined || r.value === '' ? '…' : String(r.value);
      return `${r.key || '…'} ${label} ${r.type === 'number' ? v : `“${v}”`}`;
    }
    case 'activity': return `${EVENT_LABEL[r.event][r.op === 'happened' ? 0 : 1]} in the last ${r.days || '…'} days`;
  }
}

export function describeFilters(f: SegmentFilters): string {
  const groups = f.groups.filter(g => g.rules.length);
  if (!groups.length) return 'All contacts. No rules yet.';
  const text = (g: SegmentGroup) => g.rules.map(describeRule).join(g.match === 'all' ? ' and ' : ' or ');
  return 'Contacts who ' + groups.map(g => (groups.length > 1 ? `(${text(g)})` : text(g))).join(f.match === 'all' ? ' and ' : ' or ') + '.';
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** English words for 0–999,999 (falls back to numerals above). */
export function countInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999999) return new Intl.NumberFormat('en-AU').format(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + countInWords(n % 100) : '');
  const r = n % 1000;
  return countInWords(Math.floor(n / 1000)) + ' thousand' + (r ? (r < 100 ? ' and ' : ' ') + countInWords(r) : '');
}

/* ---------- Component ---------- */
export interface SendThanksSegmentsProps {
  savedSegments: SavedSegment[];
  selectedSegmentId: string | null;
  name: string;
  filters: SegmentFilters;
  /** Live result from the server for the current filters */
  count: number | null;
  countStatus: 'idle' | 'loading' | 'ready' | 'error';
  totalContacts?: number | null;
  /** Set true after the first save attempt to show inline errors */
  showErrors?: boolean;
  saving?: boolean;
  notice?: string | null;
  layout?: 'desktop' | 'mobile';
  onNameChange: (name: string) => void;
  onFiltersChange: (filters: SegmentFilters) => void;
  onSelectSegment: (id: string) => void;
  onNewSegment: () => void;
  onSave: () => void;
  onRetryCount?: () => void;
}

export function SendThanksSegments(p: SendThanksSegmentsProps) {
  const uid = useId();
  const mobile = p.layout === 'mobile';
  const nf = new Intl.NumberFormat('en-AU');
  const f = p.filters;
  const v = validateSegment(p.name, f);
  const show = !!p.showErrors;
  const set = (fn: (d: SegmentFilters) => void) => { const d: SegmentFilters = JSON.parse(JSON.stringify(f)); fn(d); p.onFiltersChange(d); };
  const patchRule = (gi: number, ri: number, patch: Partial<SegmentRule> | SegmentRule, replace = false) =>
    set(d => { d.groups[gi].rules[ri] = (replace ? patch : { ...d.groups[gi].rules[ri], ...patch }) as SegmentRule; });

  const countBlock = (() => {
    if (p.countStatus === 'loading') return <><span className={styles.countNum} aria-hidden="true">…</span><span className={styles.countWords}>Counting contacts…</span></>;
    if (p.countStatus === 'error') return <><span className={styles.countWords}>Couldn’t count contacts.</span>{p.onRetryCount && <button type="button" className={styles.btn} onClick={p.onRetryCount}>Try again</button>}</>;
    if (p.count == null) return <span className={styles.countWords}>Add rules to see a count.</span>;
    return <><span className={styles.countNum}>{nf.format(p.count)}</span><span className={styles.countWords}>{countInWords(p.count)} {p.count === 1 ? 'contact matches' : 'contacts match'}</span>
      {p.totalContacts != null && <span className={styles.mono}>OF {nf.format(p.totalContacts)}</span>}</>;
  })();

  const ruleFields = (r: SegmentRule, gi: number, ri: number, n: string) => {
    switch (r.kind) {
      case 'tag': return (<>
        <select className={styles.control} value={r.op} aria-label={`${n} condition`} onChange={e => patchRule(gi, ri, { op: e.target.value as TagRule['op'] })}><option value="has">has tag</option><option value="not_has">doesn’t have tag</option></select>
        <input className={`${styles.control} ${styles.grow}`} value={r.value} placeholder="tag name" aria-label={`${n} value`} onChange={e => patchRule(gi, ri, { value: e.target.value })} />
      </>);
      case 'consent': return (<>
        <span className={styles.word}>is</span>
        <select className={`${styles.control} ${styles.grow}`} value={r.value} aria-label={`${n} value`} onChange={e => patchRule(gi, ri, { value: e.target.value as ConsentRule['value'] })}><option value="opted_in">Opted in</option><option value="not_recorded">No consent recorded</option></select>
      </>);
      case 'unsubscribed': return (
        <select className={`${styles.control} ${styles.grow}`} value={String(r.value)} aria-label={`${n} value`} onChange={e => patchRule(gi, ri, { value: e.target.value === 'true' })}><option value="false">Is not unsubscribed</option><option value="true">Is unsubscribed</option></select>
      );
      case 'property': return (<>
        <input className={`${styles.control} ${styles.mono} ${styles.grow}`} value={r.key} placeholder="property" spellCheck={false} aria-label={`${n} property name`} onChange={e => patchRule(gi, ri, { key: e.target.value })} />
        <select className={styles.control} value={r.type} aria-label={`${n} property type`} onChange={e => patchRule(gi, ri, { kind: 'property', key: r.key, type: e.target.value as 'string', op: e.target.value === 'number' ? 'eq' : 'equals', value: '' } as PropertyRule, true)}><option value="string">Text</option><option value="number">Number</option></select>
        <select className={`${styles.control} ${styles.grow}`} value={r.op} aria-label={`${n} condition`} onChange={e => patchRule(gi, ri, { op: e.target.value } as Partial<PropertyRule>)}>
          {(r.type === 'number' ? NUM_OPS : STR_OPS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        {!NO_VALUE.has(r.op) && <input className={`${styles.control} ${styles.grow}`} value={r.value === undefined ? '' : String(r.value)} inputMode={r.type === 'number' ? 'decimal' : 'text'} placeholder="value" aria-label={`${n} value`} onChange={e => patchRule(gi, ri, { value: e.target.value } as Partial<PropertyRule>)} />}
      </>);
      case 'activity': return (<>
        <select className={styles.control} value={r.op} aria-label={`${n} condition`} onChange={e => patchRule(gi, ri, { op: e.target.value as ActivityRule['op'] })}><option value="happened">was</option><option value="not_happened">was not</option></select>
        <select className={`${styles.control} ${styles.grow}`} value={r.event} aria-label={`${n} activity`} onChange={e => patchRule(gi, ri, { event: e.target.value as ActivityEvent })}>
          <option value="sent">sent an email</option><option value="delivered">delivered an email</option><option value="opened">opened an email</option><option value="clicked">clicked in an email</option><option value="bounced">bounced</option><option value="complained">complained</option>
        </select>
        <span className={styles.days}>in the last
          <input className={`${styles.control} ${styles.daysInput}`} type="number" min={DAYS_MIN} max={DAYS_MAX} inputMode="numeric" value={Number.isFinite(r.days) ? r.days : ''} aria-label={`${n} number of days`}
            onChange={e => patchRule(gi, ri, { days: e.target.value === '' ? NaN : Number(e.target.value) })} />days</span>
      </>);
    }
  };

  return (
    <div className={mobile ? styles.rootM : styles.root}>
      <section aria-labelledby={`${uid}-saved`} className={`${styles.card} ${styles.saved}`}>
        <div className={styles.cardHead}><h2 id={`${uid}-saved`} className={styles.h2}>Saved segments</h2>
          <button type="button" className={styles.btn} onClick={p.onNewSegment}>New segment</button></div>
        {p.savedSegments.length === 0 && <div className={styles.emptySmall}>No saved segments yet.</div>}
        <ul className={styles.savedList}>
          {p.savedSegments.map(s => (
            <li key={s.id}><button type="button" className={`${styles.savedItem} ${s.id === p.selectedSegmentId ? styles.on : ''}`} aria-current={s.id === p.selectedSegmentId || undefined} onClick={() => p.onSelectSegment(s.id)}>
              <span className={styles.savedName}>{s.name}</span><span className={styles.mono}>{s.contactCount == null ? '…' : nf.format(s.contactCount)}</span>
            </button></li>))}
        </ul>
      </section>

      <div className={styles.builder}>
        <div className={styles.stack}>
          <div className={styles.eyebrow}>SEGMENTS / {p.selectedSegmentId ? 'EDIT' : 'NEW'}</div>
          <label className={styles.field}><span className={styles.label}>Segment name</span>
            <input className={`${styles.control} ${styles.nameInput} ${show && v.name ? styles.invalid : ''}`} value={p.name} placeholder="e.g. Pro plan, opened lately" aria-invalid={show && !!v.name} onChange={e => p.onNameChange(e.target.value)} /></label>
          {show && v.name && <span role="alert" className={styles.error}>{v.name}</span>}
        </div>

        <section aria-label="Live result" className={`${styles.card} ${styles.result}`}>
          <div className={styles.count} aria-live="polite">{countBlock}</div>
          <div className={styles.summary}><span className={styles.mono}>SUMMARY</span><p className={styles.summaryText}>{describeFilters(f)}</p></div>
          <button type="button" className={styles.btnPrimary} onClick={p.onSave} disabled={p.saving}>{p.saving ? 'Saving…' : 'Save segment'}</button>
        </section>
        {p.notice && <div role="status" className={styles.notice}>{p.notice}</div>}
        {show && v.count > 0 && <div role="alert" className={styles.errorBanner}>{v.count} {v.count === 1 ? 'thing needs' : 'things need'} fixing before this segment can be saved.</div>}

        <section aria-labelledby={`${uid}-rules`} className={styles.stack}>
          <div className={styles.rulesHead}>
            <h2 id={`${uid}-rules`} className={styles.h2lg}>Rules</h2>
            {f.groups.length > 1 && <label className={styles.inline}>Groups
              <select className={styles.control} value={f.match} onChange={e => set(d => { d.match = e.target.value as Match; })}><option value="all">all must match (AND)</option><option value="any">any can match (OR)</option></select></label>}
          </div>

          {f.groups.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>No rules yet</div>
              <p className={styles.muted}>Without rules this segment includes every contact. Add a rule to narrow it down by tag, consent, unsubscribe state, a contact property or recent email activity.</p>
              <button type="button" className={styles.btnPrimary} onClick={() => set(d => { d.groups.push({ match: 'all', rules: [newRule('property')] }); })}>Add first rule</button>
            </div>
          )}

          {f.groups.map((g, gi) => (
            <div key={gi} className={styles.stack}>
              {gi > 0 && <div className={styles.groupJoin}>{f.match === 'all' ? 'AND' : 'OR'}</div>}
              <fieldset className={styles.group}>
                <legend className={styles.legend}>Group {gi + 1}</legend>
                <div className={styles.groupHead}>
                  <label className={styles.inline}>Contacts match
                    <select className={styles.control} value={g.match} aria-label={`Group ${gi + 1} matching`} onChange={e => set(d => { d.groups[gi].match = e.target.value as Match; })}><option value="all">all rules (AND)</option><option value="any">any rule (OR)</option></select></label>
                  {f.groups.length > 1 && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => set(d => { d.groups.splice(gi, 1); })}>Remove group</button>}
                </div>
                <ol className={styles.rules}>
                  {g.rules.map((r, ri) => {
                    const n = `Group ${gi + 1} rule ${ri + 1}`, err = show ? v.rules.get(`${gi}:${ri}`) : undefined;
                    return (
                      <li key={ri} className={styles.ruleItem}>
                        {ri > 0 && <span className={styles.ruleJoin}>{g.match === 'all' ? 'AND' : 'OR'}</span>}
                        <div className={`${styles.rule} ${err ? styles.ruleInvalid : ''}`}>
                          <select className={`${styles.control} ${styles.kind}`} value={r.kind} aria-label={`${n} type`} onChange={e => patchRule(gi, ri, newRule(e.target.value as SegmentRule['kind']), true)}>
                            <option value="tag">Tag</option><option value="consent">Consent</option><option value="unsubscribed">Unsubscribe state</option><option value="property">Contact property</option><option value="activity">Email activity</option>
                          </select>
                          <div className={styles.fields}>{ruleFields(r, gi, ri, n)}</div>
                          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} aria-label={`Remove ${n}`}
                            onClick={() => set(d => { d.groups[gi].rules.splice(ri, 1); if (!d.groups[gi].rules.length) d.groups.splice(gi, 1); })}>Remove</button>
                        </div>
                        {err && <span role="alert" className={styles.error}>{err}</span>}
                      </li>);
                  })}
                </ol>
                <button type="button" className={styles.btn} onClick={() => set(d => { d.groups[gi].rules.push(newRule('activity')); })}>Add rule</button>
              </fieldset>
            </div>
          ))}
          {f.groups.length > 0 && <button type="button" className={`${styles.btn} ${styles.btnDashed}`} onClick={() => set(d => { d.groups.push({ match: 'all', rules: [newRule('tag')] }); })}>Add a group</button>}
        </section>
      </div>
    </div>
  );
}

export default SendThanksSegments;
