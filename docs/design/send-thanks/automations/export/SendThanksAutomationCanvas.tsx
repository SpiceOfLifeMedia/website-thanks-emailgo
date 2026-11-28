'use client';

import { KeyboardEvent, ReactElement, useEffect, useId, useState } from 'react';
import styles from './send-thanks-automation-canvas.module.css';

/* ---------- Exact server model (lib/automations.ts) ---------- */
export type AutomationStep = { key: string; type: string; config: Record<string, unknown> };
export type AutomationConnection = { from: string; to: string; condition?: 'true' | 'false' };
export type StepType = 'trigger' | 'condition' | 'delay' | 'wait_for_event' | 'send_email' | 'contact_update' | 'add_to_segment';
export type ValidationIssue = { stepKey?: string | null; message: string };
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
export type ActivationState = 'idle' | 'confirming' | 'activating';

/** Canvas-only data lives here inside step.config. It never changes workflow behaviour. */
export const CANVAS_KEY = '__sendThanksCanvas';
export type CanvasMeta = { dx?: number; dy?: number };
export const canvasMeta = (s: AutomationStep): CanvasMeta => {
  const m = s.config[CANVAS_KEY];
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as CanvasMeta) : {};
};

export const STEP_LABEL: Record<StepType, string> = {
  trigger: 'Trigger', condition: 'Condition', delay: 'Delay', wait_for_event: 'Wait for event',
  send_email: 'Send email', contact_update: 'Update contact', add_to_segment: 'Add to segment',
};
export const ADDABLE: StepType[] = ['condition', 'delay', 'wait_for_event', 'send_email', 'contact_update', 'add_to_segment'];

/** Editable fields per type. Every other config key (including unknown ones) is preserved untouched. */
/** Operators accepted by the server's validCondition(). */
export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'exists', 'is_empty'] as const;
const FIELDS: Record<string, { path: string; label: string; mono?: boolean; hint?: string; options?: readonly string[] }[]> = {
  trigger: [{ path: 'event_name', label: 'Event name', mono: true }],
  condition: [{ path: 'field', label: 'Contact field', mono: true, hint: 'Starts with contact., event. or wait_events., for example contact.properties.plan.' }, { path: 'operator', label: 'Operator', mono: true, options: OPERATORS }, { path: 'value', label: 'Value', hint: 'Not used with exists or is_empty.' }],
  delay: [{ path: 'duration', label: 'Duration', hint: 'For example "2 days". Up to 30 days.' }],
  wait_for_event: [{ path: 'event_name', label: 'Event name', mono: true }, { path: 'timeout', label: 'Timeout', hint: 'For example "3 days".' }],
  send_email: [{ path: 'template.id', label: 'Template ID', mono: true }, { path: 'from', label: 'From address' }],
  contact_update: [],
  add_to_segment: [{ path: 'segment_id', label: 'Segment ID', mono: true }],
};
const getPath = (o: Record<string, unknown>, p: string): string => {
  const v = p.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
};
export const setPath = (o: Record<string, unknown>, p: string, v: unknown): Record<string, unknown> => {
  const [k, ...rest] = p.split('.');
  if (!rest.length) return { ...o, [k]: v };
  const child = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? (o[k] as Record<string, unknown>) : {};
  return { ...o, [k]: setPath(child, rest.join('.'), v) };
};

/* ---------- Pure graph helpers for the host's callbacks ---------- */
export const outgoing = (c: AutomationConnection[], key: string) => c.filter(e => e.from === key);

/** Insert a step after `afterKey` (optionally on a condition branch), keeping the old next step after it. */
export function insertStep(steps: AutomationStep[], connections: AutomationConnection[], step: AutomationStep, afterKey: string, branch?: 'true' | 'false') {
  const old = connections.find(e => e.from === afterKey && (branch ? e.condition === branch : !e.condition));
  const rest = connections.filter(e => e !== old);
  const next: AutomationConnection[] = [...rest, { from: afterKey, to: step.key, ...(branch ? { condition: branch } : {}) }];
  if (old) next.push(step.type === 'condition' ? { from: step.key, to: old.to, condition: 'true' } : { from: step.key, to: old.to });
  return { steps: [...steps, step], connections: next };
}

/** Remove a step; a single incoming edge is reconnected to its single outgoing target. */
export function removeStep(steps: AutomationStep[], connections: AutomationConnection[], key: string) {
  const ins = connections.filter(e => e.to === key), outs = outgoing(connections, key);
  let next = connections.filter(e => e.from !== key && e.to !== key);
  if (outs.length === 1) next = next.concat(ins.map(e => ({ ...e, to: outs[0].to })));
  return { steps: steps.filter(s => s.key !== key), connections: next };
}

/** Swap a non-branching step with the non-branching step before it (move earlier). */
export function moveEarlier(connections: AutomationConnection[], key: string): AutomationConnection[] | null {
  const inB = connections.filter(e => e.to === key);
  if (inB.length !== 1 || inB[0].condition) return null;
  const a = inB[0].from, inA = connections.filter(e => e.to === a), outB = outgoing(connections, key);
  if (outgoing(connections, a).length !== 1 || outB.length > 1 || outB.some(e => e.condition)) return null;
  return connections.flatMap(e => {
    if (e === inB[0]) return [{ from: key, to: a }];
    if (inA.includes(e)) return [{ ...e, to: key }];
    if (outB.includes(e)) return [{ from: a, to: e.to }];
    return [e];
  });
}

/* ---------- Component ---------- */
export interface SendThanksAutomationCanvasProps {
  name: string;
  status: 'draft' | 'active' | 'paused';
  steps: AutomationStep[];
  connections: AutomationConnection[];
  selectedKey: string | null;
  saveState: SaveState;
  savedAtLabel?: string | null;
  issues: ValidationIssue[];
  activation: ActivationState;
  /** True only after the host has wired CANVAS_KEY persistence end to end */
  positionsPersist?: boolean;
  layout?: 'desktop' | 'mobile';
  onNameChange: (name: string) => void;
  onSelect: (key: string | null) => void;
  onAddStep: (type: StepType, afterKey: string, branch?: 'true' | 'false') => void;
  onRemoveStep: (key: string) => void;
  onConfigChange: (key: string, config: Record<string, unknown>) => void;
  onConnectionsChange: (connections: AutomationConnection[]) => void;
  onPositionChange: (key: string, meta: CanvasMeta) => void;
  onSaveDraft: () => void;
  onRequestActivate: () => void;
  onConfirmActivate: () => void;
  onCancelActivate: () => void;
}

export function SendThanksAutomationCanvas(p: SendThanksAutomationCanvasProps) {
  const uid = useId();
  const [branchType, setBranchType] = useState<Record<string, StepType>>({});
  const [jsonDraft, setJsonDraft] = useState<{ key: string; text: string; error: string } | null>(null);
  const mobile = p.layout === 'mobile';
  const byKey = new Map(p.steps.map(s => [s.key, s]));
  const sel = p.selectedKey ? byKey.get(p.selectedKey) ?? null : null;
  const issuesFor = (k: string) => p.issues.filter(i => i.stepKey === k).map(i => i.message);
  const label = (s: AutomationStep) => STEP_LABEL[s.type as StepType] ?? s.type;
  const summary = (s: AutomationStep): string => {
    const c = s.config;
    switch (s.type) {
      case 'trigger': return `When ${getPath(c, 'event_name') || 'an event'} happens`;
      case 'condition': return `${getPath(c, 'field') || 'field'} ${getPath(c, 'operator') || '…'} ${getPath(c, 'value')}`.trim();
      case 'delay': return `Wait ${getPath(c, 'duration') || '…'}`;
      case 'wait_for_event': return `Until ${getPath(c, 'event_name') || 'an event'}, up to ${getPath(c, 'timeout') || '…'}`;
      case 'send_email': return `Template ${getPath(c, 'template.id') || '…'}`;
      case 'contact_update': return 'Change contact fields';
      case 'add_to_segment': return `Segment ${getPath(c, 'segment_id') || '…'}`;
      default: return '';
    }
  };
  const saveText = { saved: `Draft saved${p.savedAtLabel ? ' ' + p.savedAtLabel : ''}`, unsaved: 'Unsaved changes', saving: 'Saving draft…', error: 'Draft not saved. Try again.' }[p.saveState];
  const nudge = (s: AutomationStep, dx: number, dy: number) => {
    const m = canvasMeta(s); p.onPositionChange(s.key, { dx: Math.max(-240, Math.min(240, (m.dx ?? 0) + dx)), dy: Math.max(-120, Math.min(120, (m.dy ?? 0) + dy)) });
  };
  const cardKeys = (s: AutomationStep) => (e: KeyboardEvent) => {
    if (!e.altKey || mobile) return;
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (d) { e.preventDefault(); nudge(s, d[0], d[1]); }
  };

  const seen = new Set<string>();
  const card = (s: AutomationStep) => {
    const iss = issuesFor(s.key), on = s.key === p.selectedKey, m = canvasMeta(s);
    return (
      <button type="button" className={`${styles.card} ${on ? styles.on : ''} ${iss.length ? styles.cardIssue : ''}`} aria-pressed={on} onKeyDown={cardKeys(s)}
        style={!mobile && (m.dx || m.dy) ? { transform: `translate(${m.dx ?? 0}px, ${m.dy ?? 0}px)` } : undefined}
        aria-label={`${label(s)}: ${summary(s)}${iss.length ? '. Needs attention: ' + iss.join(' ') : ''}`} onClick={() => p.onSelect(s.key)}>
        <span className={styles.kind}>{label(s).toUpperCase()} · {s.key}</span>
        <span className={styles.cardTitle}>{summary(s)}</span>
        {iss[0] && <span className={styles.issueChip}>{iss[0]}</span>}
      </button>
    );
  };
  const addBtn = (afterKey: string, branch?: 'true' | 'false') => (
    <button type="button" className={styles.add} onClick={() => p.onAddStep('delay', afterKey, branch)} aria-label={`Add a step after ${afterKey}${branch ? ` on the ${branch} branch` : ''}`}>+ Add step</button>
  );
  const chain = (key: string): ReactElement | null => {
    const s = byKey.get(key); if (!s) return null;
    if (seen.has(key)) return <li className={styles.join}>Joins {s.key}</li>;
    seen.add(key);
    const outs = outgoing(p.connections, key);
    return (
      <li className={styles.item}>
        {card(s)}
        {s.type === 'condition' ? (
          <div className={styles.branches}>
            {(['true', 'false'] as const).map(b => { const e = outs.find(x => x.condition === b); return (
              <section key={b} className={styles.branch} aria-label={`${b === 'true' ? 'True' : 'False'} branch`}>
                <span className={`${styles.edge} ${b === 'true' ? styles.edgeTrue : styles.edgeFalse}`}>{b === 'true' ? 'If true' : 'If false'}</span>
                {e ? <ol className={styles.flow}>{chain(e.to)}</ol> : (
                  <div className={styles.emptyBranch}>
                    <span>No steps on this branch yet.</span>
                    <label className={styles.field}><span className={styles.label}>Step type</span>
                      <select className={styles.control} value={branchType[`${key}:${b}`] ?? 'send_email'} onChange={ev => setBranchType(t => ({ ...t, [`${key}:${b}`]: ev.target.value as StepType }))}>
                        {(['send_email', 'delay', 'wait_for_event', 'contact_update', 'add_to_segment', 'condition'] as StepType[]).map(t => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}
                      </select></label>
                    <button type="button" className={styles.btnPrimary} onClick={() => p.onAddStep(branchType[`${key}:${b}`] ?? 'send_email', key, b)}>Add step to {b === 'true' ? 'If true' : 'If false'}</button>
                  </div>)}
              </section>); })}
          </div>
        ) : outs[0] ? (<><span className={styles.line} aria-hidden="true" /><ol className={styles.flow}>{chain(outs[0].to)}</ol></>)
          : <><span className={styles.line} aria-hidden="true" />{addBtn(key)}</>}
      </li>
    );
  };
  const first = p.steps[0];
  const tree = first ? <ol className={styles.flow} aria-label="Workflow steps">{chain(first.key)}</ol> : null;
  const loose = p.steps.filter(s => !seen.has(s.key));

  const connectSelect = (from: string, branch?: 'true' | 'false') => {
    const e = p.connections.find(x => x.from === from && (branch ? x.condition === branch : !x.condition));
    const set = (to: string) => p.onConnectionsChange([...p.connections.filter(x => x !== e), ...(to ? [{ from, to, ...(branch ? { condition: branch } : {}) }] : [])]);
    return (
      <label className={styles.field}><span className={styles.label}>{branch ? `If ${branch}, go to` : 'Next step'}</span>
        <select className={styles.control} value={e?.to ?? ''} onChange={ev => set(ev.target.value)}>
          <option value="">Not connected</option>
          {p.steps.filter(s => s.key !== from && s.type !== 'trigger').map(s => <option key={s.key} value={s.key}>{s.key} · {label(s)}</option>)}
        </select></label>
    );
  };

  const inspector = sel && (
    <section className={styles.inspector} aria-labelledby={`${uid}-insp`}>
      <h2 id={`${uid}-insp`} className={styles.h2}>{label(sel)} <span className={styles.mono}>{sel.key}</span></h2>
      {issuesFor(sel.key).map((m, i) => <div key={i} role="note" className={styles.issueNote}>{m}</div>)}
      {(FIELDS[sel.type] ?? []).map(f => (
        <label key={f.path} className={styles.field}><span className={styles.label}>{f.label}</span>
          {f.options ? (
            <select className={`${styles.control} ${styles.monoInput}`} value={getPath(sel.config, f.path)} onChange={e => p.onConfigChange(sel.key, setPath(sel.config, f.path, e.target.value))}>
              {!f.options.includes(getPath(sel.config, f.path)) && <option value={getPath(sel.config, f.path)}>Pick an operator</option>}
              {f.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
          <input className={`${styles.control} ${f.mono ? styles.monoInput : ''}`} value={getPath(sel.config, f.path)} spellCheck={!f.mono}
            onChange={e => p.onConfigChange(sel.key, setPath(sel.config, f.path, e.target.value))} />)}
          {f.hint && <span className={styles.hint}>{f.hint}</span>}</label>
      ))}
      {sel.type === 'contact_update' && (() => {
        const current = JSON.stringify(sel.config.updates ?? {}, null, 2);
        const d = jsonDraft && jsonDraft.key === sel.key ? jsonDraft : { key: sel.key, text: current, error: '' };
        const change = (text: string) => {
          try {
            const v = JSON.parse(text);
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Updates must be a JSON object, like { "tags": ["vip"] }.');
            setJsonDraft({ key: sel.key, text, error: '' });
            p.onConfigChange(sel.key, { ...sel.config, updates: v });
          } catch (err) { setJsonDraft({ key: sel.key, text, error: err instanceof SyntaxError ? `Not valid JSON yet: ${err.message}` : (err as Error).message }); }
        };
        return (
          <label className={styles.field}><span className={styles.label}>Updates (JSON)</span>
            <textarea className={`${styles.control} ${styles.json} ${d.error ? styles.invalid : ''}`} rows={8} spellCheck={false} value={d.text} aria-invalid={!!d.error}
              aria-describedby={`${uid}-json-hint${d.error ? ` ${uid}-json-err` : ''}`} onChange={e => change(e.target.value)} />
            <span id={`${uid}-json-hint`} className={styles.hint}>Allowed keys: name, properties, tags. Changes apply only while the JSON is valid; other config keys are kept.</span>
            {d.error && <span id={`${uid}-json-err`} role="alert" className={styles.issueNote}>{d.error} Nothing was changed.</span>}
          </label>);
      })()}
      {sel.type === 'condition' ? <>{connectSelect(sel.key, 'true')}{connectSelect(sel.key, 'false')}</> : connectSelect(sel.key)}
      {sel.type !== 'trigger' && (
        <div className={styles.row}>
          <button type="button" className={styles.btn} disabled={!moveEarlier(p.connections, sel.key)} onClick={() => { const n = moveEarlier(p.connections, sel.key); if (n) p.onConnectionsChange(n); }}>Move earlier</button>
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => p.onRemoveStep(sel.key)}>Remove step</button>
        </div>
      )}
      {!mobile && (
        <fieldset className={styles.nudge}><legend className={styles.label}>Canvas position</legend>
          <div className={styles.row}>
            {([['Left', -16, 0], ['Up', 0, -16], ['Down', 0, 16], ['Right', 16, 0]] as const).map(([t, x, y]) => <button key={t} type="button" className={styles.btn} onClick={() => nudge(sel, x, y)}>{t}</button>)}
            <button type="button" className={styles.btn} onClick={() => p.onPositionChange(sel.key, {})}>Reset</button>
          </div>
          <span className={styles.hint}>{p.positionsPersist ? 'Position is saved with the draft.' : 'Position is for this session only. It isn’t saved yet.'} Alt + arrow keys also move a selected card.</span>
        </fieldset>
      )}
    </section>
  );

  return (
    <div className={mobile ? styles.rootM : styles.root}>
      <header className={styles.top}>
        <label className={styles.nameWrap}><span className={styles.srOnly}>Workflow name</span>
          <input className={styles.name} value={p.name} onChange={e => p.onNameChange(e.target.value)} /></label>
        <span className={styles.status}>{p.status === 'draft' ? 'Draft' : p.status === 'active' ? 'Active' : 'Paused'}</span>
        <span aria-live="polite" className={styles.save}>{saveText}</span>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={p.onSaveDraft} disabled={p.saveState === 'saving'}>Save draft</button>
          <button type="button" className={styles.btnPrimary} onClick={p.onRequestActivate} disabled={p.activation !== 'idle' || p.issues.length > 0}>Activate</button>
        </div>
      </header>
      <p className={styles.hint}>Save draft only saves. Nothing runs until you activate.</p>
      {p.activation !== 'idle' && (
        <div role="alertdialog" aria-labelledby={`${uid}-act`} className={styles.confirm}>
          <div id={`${uid}-act`} className={styles.strong}>Activate “{p.name}”?</div>
          <div>Once active, the workflow starts for every new {getPath(first?.config ?? {}, 'event_name') || 'trigger'} event. Active workflows can’t be edited until they’re paused.</div>
          <div className={styles.row}>
            <button type="button" className={styles.btn} onClick={p.onCancelActivate} autoFocus>Keep as draft</button>
            <button type="button" className={styles.btnInk} onClick={p.onConfirmActivate} disabled={p.activation === 'activating'}>{p.activation === 'activating' ? 'Activating…' : 'Activate workflow'}</button>
          </div>
        </div>
      )}
      {p.issues.length > 0 && (
        <section role="alert" className={styles.problems} aria-label="Problems">
          <strong>{p.issues.length} {p.issues.length === 1 ? 'problem' : 'problems'} to fix before activating</strong>
          <ul className={styles.problemList}>{p.issues.map((i, n) => <li key={n}>{i.stepKey ? <button type="button" className={styles.link} onClick={() => p.onSelect(i.stepKey!)}>{i.stepKey}</button> : null} {i.message}</li>)}</ul>
        </section>
      )}
      <div className={styles.grid}>
        <nav aria-label="Add a step" className={styles.palette}>
          <span className={styles.label}>Add after {sel ? sel.key : 'the last step'}</span>
          {ADDABLE.map(t => <button key={t} type="button" className={styles.paletteItem} disabled={!p.steps.length}
            onClick={() => p.onAddStep(t, sel?.key ?? p.steps[p.steps.length - 1].key)}>{STEP_LABEL[t]}</button>)}
        </nav>
        <section className={styles.canvas} aria-label="Workflow canvas">
          {!p.steps.length ? (
            <div className={styles.empty}><div className={styles.strong}>No steps yet</div><p className={styles.hint}>Every workflow starts with one trigger. The host creates it with an event name, then you can add steps here.</p></div>
          ) : tree}
          {loose.length > 0 && <section className={styles.loose} aria-label="Not connected"><strong>Not connected</strong><ul className={styles.flow}>{loose.map(s => <li key={s.key} className={styles.item}>{card(s)}</li>)}</ul></section>}
        </section>
        {!mobile && (inspector || <section className={styles.inspector}><div className={styles.strong}>Pick a step</div><p className={styles.hint}>Select a step to edit it, connect its branches or move it.</p></section>)}
      </div>
      {mobile && inspector}
    </div>
  );
}

export default SendThanksAutomationCanvas;
