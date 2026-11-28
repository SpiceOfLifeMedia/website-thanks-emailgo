import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import s from './send-thanks-automation-run-retry.module.css';

/**
 * Send, thanks: Automations run history with failed step recovery.
 * Drop-in for the `openId === automation.id && <div className="automationRuns">…` block of
 * AutomationWorkspace. Keeps its list → run summary → run detail → step history structure.
 * Never retries anything itself; it calls onRetryFailedStep.
 */

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'retrying' | (string & {});
export type StepStatus = 'completed' | 'failed' | 'queued' | 'running' | 'waiting' | 'skipped' | 'not_started' | (string & {});

export interface Run {
  id: string; event_name: string; contact_id: string | null; email: string | null; status: RunStatus;
  current_step_key: string | null; started_at: string; completed_at: string | null; error: string | null;
}
export interface RunStep {
  id: string; step_key: string; step_type: string; status: StepStatus;
  started_at: string; finished_at: string | null; error: string | null; input: unknown; output: unknown;
  /** 1-based. Rows with the same step_key and higher attempt are retries. Defaults to 1. */
  attempt?: number;
}
export interface RunDetail {
  status: RunStatus; steps: RunStep[];
  event?: { id?: string; name: string; received_at?: string; payload?: unknown };
  contact?: { id?: string | null; email?: string | null; name?: string | null };
  /** Step keys in workflow order, so steps that have not started can be listed. */
  step_order?: { key: string; type: string }[];
}
export interface RetryRequest {
  runId: string; stepKey: string; stepType: string;
  /** Attempt number the retry will create. */
  attempt: number;
  /** Step keys that completed earlier and must not rerun. */
  keepStepKeys: string[];
  /** true only for send_email after the user ticked the duplicate risk box. */
  acknowledgedDuplicateRisk: boolean;
}

export interface AutomationRunRetryProps {
  automationName: string;
  runs: Run[];
  details: Record<string, RunDetail | 'loading' | 'error' | undefined>;
  expandedRunId: string | null;
  onToggleRun: (run: Run) => void;
  onRetryFailedStep: (req: RetryRequest) => void | Promise<void>;
  onStopRun?: (run: Run) => void | Promise<void>;
  /** Run id with a request in flight. */
  busyRunId?: string | null;
  formatDate?: (iso: string) => string;
  stepTypeLabels?: Record<string, string>;
}

const STATUS_WORD: Record<string, string> = {
  completed: 'Completed', failed: 'Failed', queued: 'Queued', running: 'Running', waiting: 'Waiting',
  retrying: 'Retrying', stopped: 'Stopped', skipped: 'Skipped', not_started: 'Not started',
};
const TYPE_LABEL: Record<string, string> = {
  trigger: 'Trigger', wait: 'Wait', delay: 'Delay', condition: 'Condition', send_email: 'Send email',
  add_to_segment: 'Add to segment', contact_update: 'Update contact', event_only: 'Record event',
};
const word = (v: string) => STATUS_WORD[v] ?? v.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const pillCls = (v: string) =>
  v === 'failed' ? s.pillFailed : v === 'queued' || v === 'retrying' ? s.pillQueued
    : v === 'waiting' || v === 'running' ? s.pillWaiting : v === 'completed' ? '' : s.pillMuted;
const defaultDate = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

interface StepGroup { key: string; type: string; attempts: RunStep[]; status: StepStatus }

/** Group step rows by step_key in workflow order, attempts ascending. */
export function groupSteps(detail: RunDetail): StepGroup[] {
  const order: { key: string; type: string }[] = detail.step_order ? [...detail.step_order] : [];
  for (const st of detail.steps) if (!order.some(o => o.key === st.step_key)) order.push({ key: st.step_key, type: st.step_type });
  return order.map(o => {
    const attempts = detail.steps.filter(st => st.step_key === o.key).sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
    return { key: o.key, type: o.type, attempts, status: attempts.length ? attempts[attempts.length - 1].status : 'not_started' };
  });
}

/** The failed step to retry, or null. Only when the run itself is failed. */
export function findFailedStep(run: Run, groups: StepGroup[]) {
  if (run.status !== 'failed') return null;
  const idx = groups.findIndex(g => g.status === 'failed');
  if (idx < 0) return null;
  const g = groups[idx];
  return {
    group: g,
    nextAttempt: Math.max(...g.attempts.map(a => a.attempt ?? 1)) + 1,
    keep: groups.slice(0, idx).filter(x => x.status === 'completed').map(x => x.key),
  };
}

export default function AutomationRunRetry(p: AutomationRunRetryProps) {
  const uid = useId().replace(/:/g, '');
  const fmt = p.formatDate ?? defaultDate;
  const types = { ...TYPE_LABEL, ...p.stepTypeLabels };
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    if (focusAfter.current) { document.getElementById(focusAfter.current)?.focus(); focusAfter.current = null; }
  });
  useEffect(() => { if (confirmRunId && p.expandedRunId !== confirmRunId) { setConfirmRunId(null); setAck(false); } }, [p.expandedRunId, confirmRunId]);

  const ids = (runId: string) => {
    const b = `${uid}-${runId}`;
    return { toggle: `${b}-t`, detail: `${b}-d`, retry: `${b}-r`, ack: `${b}-a`, title: `${b}-ct`, desc: `${b}-cd`, go: `${b}-go` };
  };

  if (!p.runs.length) return <div className={s.empty}>No runs recorded for this automation.</div>;

  return (
    <div className={s.root}>
      <h3 className={s.h3}>Runs</h3>
      <ul className={s.runs} aria-label={`Runs for ${p.automationName}`}>
        {p.runs.map(run => {
          const id = ids(run.id);
          const open = p.expandedRunId === run.id;
          const detail = p.details[run.id];
          const groups = detail && typeof detail === 'object' ? groupSteps(detail) : [];
          const failed = detail && typeof detail === 'object' ? findFailedStep(run, groups) : null;
          const isSend = failed?.group.type === 'send_email';
          const confirming = open && confirmRunId === run.id && !!failed;
          const busy = p.busyRunId === run.id;
          const email = (typeof detail === 'object' && detail.contact?.email) || run.email;
          const lastAttempt = failed ? failed.nextAttempt - 1 : 0;
          const keptText = failed?.keep.length ? `Completed steps (${failed.keep.join(', ')}) are kept and won't run again.` : 'No earlier steps completed.';
          const cancel = () => { setConfirmRunId(null); setAck(false); setRetryError(null); focusAfter.current = id.retry; };
          const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
          const confirm = async () => {
            if (!failed || busy || (isSend && !ack)) return;
            setRetryError(null);
            try {
              await p.onRetryFailedStep({ runId: run.id, stepKey: failed.group.key, stepType: failed.group.type, attempt: failed.nextAttempt, keepStepKeys: failed.keep, acknowledgedDuplicateRisk: isSend && ack });
              setConfirmRunId(null); setAck(false);
            } catch (cause) {
              setRetryError(cause instanceof Error ? cause.message : 'Could not queue this retry.');
            }
          };

          return (
            <li key={run.id} className={s.run}>
              <div className={s.summary}>
                <button id={id.toggle} type="button" className={s.summaryBtn} aria-expanded={open} aria-controls={id.detail} onClick={() => p.onToggleRun(run)}>
                  <span className={s.summaryTitle}>{run.event_name} · {run.email ?? run.contact_id ?? 'No contact'}</span>
                  <span className={s.summaryMeta}><time dateTime={run.started_at} suppressHydrationWarning>{fmt(run.started_at)}</time> · {open ? 'Hide details' : 'Show details'}</span>
                </button>
                <span className={`${s.pill} ${pillCls(run.status)}`}>{word(run.status)}</span>
                {['running', 'waiting'].includes(run.status) && p.onStopRun && (
                  <button type="button" className={s.btn} disabled={busy} onClick={() => p.onStopRun?.(run)}>Stop run</button>
                )}
              </div>
              {run.error && <p className={s.runError}><strong>Latest error:</strong> {run.error}</p>}

              {open && (
                <div id={id.detail} role="region" aria-label={`Run ${run.id} details`} className={s.detail}>
                  {detail === 'loading' || detail === undefined ? <p className={s.hint} role="status">Loading run detail…</p>
                    : detail === 'error' ? <p className={s.runError} role="alert">Could not load run detail. Close and open the run to try again.</p>
                    : <>
                      <div className={s.side}>
                        <div className={s.box}>
                          <h4 className={s.h4}>Event</h4>
                          <dl className={s.dl}>
                            <dt>Name</dt><dd className={s.mono}>{detail.event?.name ?? run.event_name}</dd>
                            {detail.event?.id && <><dt>Event ID</dt><dd className={s.mono}>{detail.event.id}</dd></>}
                            <dt>Received</dt><dd><time dateTime={detail.event?.received_at ?? run.started_at} suppressHydrationWarning>{fmt(detail.event?.received_at ?? run.started_at)}</time></dd>
                          </dl>
                          {detail.event?.payload !== undefined && <pre className={s.pre}>{JSON.stringify(detail.event.payload, null, 2)}</pre>}
                        </div>
                        <div className={s.box}>
                          <h4 className={s.h4}>Contact</h4>
                          <dl className={s.dl}>
                            {detail.contact?.name && <><dt>Name</dt><dd>{detail.contact.name}</dd></>}
                            <dt>Email</dt><dd>{email ?? 'No email on this event'}</dd>
                            <dt>Contact ID</dt><dd className={s.mono}>{detail.contact?.id ?? run.contact_id ?? 'None'}</dd>
                          </dl>
                        </div>
                        <code className={s.mono}>{run.id}</code>
                      </div>

                      <div className={s.main}>
                        <h4 className={s.h4}>Step history</h4>
                        <ol className={s.steps}>
                          {groups.map((g, i) => (
                            <li key={g.key} className={g.status === 'failed' ? `${s.step} ${s.stepFailed}` : s.step}>
                              <div className={s.stepTop}>
                                <span className={s.mono}>{String(i + 1).padStart(2, '0')}</span>
                                <strong className={s.stepKey}>{g.key}</strong>
                                <span className={s.hint}>{types[g.type] ?? g.type}</span>
                                <span className={`${s.pill} ${s.pillSm} ${pillCls(g.status)}`}>{word(g.status)}</span>
                              </div>
                              {g.attempts.length === 0 ? <span className={s.hint}>Waiting for earlier steps.</span> : (
                                <ul className={s.attempts} aria-label={`Attempts for ${g.key}`}>
                                  {g.attempts.map(a => (
                                    <li key={a.id} className={a.status === 'failed' ? `${s.attempt} ${s.attemptFailed}` : a.status === 'queued' ? `${s.attempt} ${s.attemptQueued}` : s.attempt}>
                                      <span className={s.attemptHead}>Attempt {a.attempt ?? 1} · {word(a.status)} · <time dateTime={a.started_at} suppressHydrationWarning>{fmt(a.started_at)}</time></span>
                                      {a.error && <span className={s.wrap}>Error: {a.error}</span>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {g.attempts.length > 0 && (
                                <details className={s.data}>
                                  <summary>Step data</summary>
                                  <pre className={s.pre}>{JSON.stringify(g.attempts.map(a => ({ attempt: a.attempt ?? 1, input: a.input, output: a.output })), null, 2)}</pre>
                                </details>
                              )}
                            </li>
                          ))}
                        </ol>

                        {failed && !confirming && (
                          <div className={s.retryRow}>
                            <button id={id.retry} type="button" className={s.retryBtn} disabled={busy}
                              onClick={() => { setConfirmRunId(run.id); setAck(false); setRetryError(null); focusAfter.current = isSend ? id.ack : id.go; }}>
                              {busy ? 'Retrying…' : 'Retry failed step'}
                            </button>
                            <span className={s.retryHint}>Reruns only {failed.group.key} as attempt {failed.nextAttempt}. Completed steps are kept.</span>
                          </div>
                        )}

                        {confirming && failed && (
                          <div role="alertdialog" aria-labelledby={id.title} aria-describedby={id.desc} onKeyDown={onKey}
                            className={isSend ? `${s.confirm} ${s.confirmRisk}` : s.confirm}>
                            {isSend ? <>
                              <h5 id={id.title} className={s.h5}>Retrying this step may send a duplicate email</h5>
                              <div id={id.desc} className={s.confirmCopy}>
                                <p>The recorded result for <strong>{failed.group.key}</strong> is Failed, but the email may already have been handed to the receiving mail server (SMTP handoff) before the failure was recorded. If it was, retrying sends <strong>{email ?? 'this contact'}</strong> a second copy.</p>
                                <p>Only {failed.group.key} reruns, as attempt {failed.nextAttempt}. {keptText} Attempt {lastAttempt} and its error stay in the history.</p>
                                <p>Not sure? Check the Emails list for this address before you retry.</p>
                              </div>
                              <label htmlFor={id.ack} className={s.ack}>
                                <input id={id.ack} type="checkbox" className={s.ackBox} checked={ack} onChange={e => setAck(e.target.checked)} />
                                <span>I understand {email ?? 'this contact'} may get this email twice.</span>
                              </label>
                              <span className={s.ackText} aria-live="polite">{ack ? 'Retry step is now available.' : 'Tick the box to turn on Retry step.'}</span>
                            </> : <>
                              <h5 id={id.title} className={s.h5}>Retry {failed.group.key}?</h5>
                              <p id={id.desc} className={s.confirmCopy}>Only this step reruns, as attempt {failed.nextAttempt}. {keptText} Earlier attempts and their errors stay in the history.</p>
                            </>}
                            <div className={s.actions}>
                              <button id={id.go} type="button" className={s.inkBtn} disabled={busy || (isSend && !ack)} onClick={confirm}>{busy ? 'Retrying…' : 'Retry step'}</button>
                              <button type="button" className={s.btn} disabled={busy} onClick={cancel}>Keep as failed</button>
                            </div>
                            {retryError && <p className={s.runError} role="alert">{retryError}</p>}
                            <span className={s.hint}>Press Escape to go back without retrying.</span>
                          </div>
                        )}
                      </div>
                    </>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
