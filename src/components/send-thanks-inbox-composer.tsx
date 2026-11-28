'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import styles from './send-thanks-inbox-composer.module.css';

/* ---------- Types (Mailbox and ThreadMessage match SharedInboxWorkspace.tsx) ---------- */
export interface Mailbox { name?: string | null; address: string }
export interface ComposerSourceMessage {
  from: Mailbox; to: Mailbox[]; cc?: Mailbox[]; replyTo?: Mailbox;
  /** Display string, e.g. "Today, 9:41 am" */
  sentAtLabel: string;
  text: string;
}
export type ComposerMode = 'reply' | 'replyAll' | 'forward';
export type DraftStatus = 'new' | 'dirty' | 'saving' | 'saved' | 'error';
export interface ComposerValue {
  mode: ComposerMode;
  /** Inbox address the message is sent from */
  from: string;
  /** Comma-separated recipients, "Name <a@b.example>" or "a@b.example" */
  to: string; cc: string; bcc: string;
  subject: string;
  /** Plain text */
  body: string;
}
export type ComposerField = 'to' | 'cc' | 'bcc' | 'subject' | 'body';
export type ComposerErrors = Partial<Record<ComposerField | 'form', string>>;

/* ---------- Pure helpers ---------- */
const ADDR = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
export const formatMailbox = (m: Mailbox) => (m.name ? `${m.name} <${m.address}>` : m.address);
export const splitRecipients = (s: string) => {
  const result: string[] = [];
  let entry = '', quoted = false, angleDepth = 0;
  for (const character of s) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '<') angleDepth += 1;
    if (!quoted && character === '>' && angleDepth > 0) angleDepth -= 1;
    if (!quoted && angleDepth === 0 && (character === ',' || character === ';')) {
      if (entry.trim()) result.push(entry.trim());
      entry = '';
    } else entry += character;
  }
  if (entry.trim()) result.push(entry.trim());
  return result;
};
export const addressOf = (entry: string) => (entry.match(/<([^>]+)>\s*$/)?.[1] ?? entry).trim();

/**
 * Prefilled recipients for a mode. The inbox address is always removed, duplicates are dropped,
 * and Bcc is never prefilled (nobody is copied silently).
 */
export function recipientsFor(mode: ComposerMode, source: ComposerSourceMessage, inboxAddress: string): { to: string; cc: string } {
  const me = inboxAddress.toLowerCase(), seen = new Set<string>([me]);
  const keep = (m: Mailbox) => { const a = m.address.toLowerCase(); if (seen.has(a)) return false; seen.add(a); return true; };
  if (mode === 'forward') return { to: '', cc: '' };
  const replyAddress = source.replyTo ?? source.from;
  if (mode === 'reply') return { to: keep(replyAddress) ? formatMailbox(replyAddress) : '', cc: '' };
  const to = [replyAddress, ...source.to].filter(keep).map(formatMailbox).join(', ');
  const cc = (source.cc ?? []).filter(keep).map(formatMailbox).join(', ');
  return { to, cc };
}

export function subjectFor(mode: ComposerMode, subject: string): string {
  const base = subject.replace(/^\s*((re|fwd?):\s*)+/i, '').trim() || '(no subject)';
  return `${mode === 'forward' ? 'Fwd' : 'Re'}: ${base}`;
}

export function validateComposer(v: ComposerValue): ComposerErrors {
  const e: ComposerErrors = {};
  const bad = (s: string) => splitRecipients(s).find(x => !ADDR.test(addressOf(x)));
  if (!splitRecipients(v.to).length) e.to = 'Add at least one recipient.';
  else if (bad(v.to)) e.to = `Check this address: ${bad(v.to)}`;
  if (bad(v.cc)) e.cc = `Check this address: ${bad(v.cc)}`;
  if (bad(v.bcc)) e.bcc = `Check this address: ${bad(v.bcc)}`;
  if (!v.subject.trim()) e.subject = 'Add a subject.';
  if (v.mode !== 'forward' && !v.body.trim()) e.body = 'Write a message before sending.';
  const n = Object.keys(e).length;
  if (n) e.form = `${n} ${n === 1 ? 'thing needs' : 'things need'} fixing before this can be sent.`;
  return e;
}

/* ---------- Component ---------- */
export interface SendThanksInboxComposerProps {
  value: ComposerValue;
  /** Inbox addresses the user may send from */
  fromOptions: Mailbox[];
  /** Message being replied to / forwarded (latest in thread) */
  source: ComposerSourceMessage;
  /** Thread subject without prefixes, for the forwarded preview */
  threadSubject: string;
  open: boolean;
  draftStatus: DraftStatus;
  /** e.g. "9:52 am" */
  savedAtLabel?: string | null;
  errors?: ComposerErrors;
  sending?: boolean;
  layout?: 'desktop' | 'mobile';
  onChange: (patch: Partial<ComposerValue>) => void;
  /** Host recomputes to/cc/subject with recipientsFor + subjectFor, keeping the body */
  onModeChange: (mode: ComposerMode) => void;
  onOpen: (mode?: ComposerMode) => void;
  /** Close keeps the draft; the host should save if draftStatus is 'dirty' */
  onClose: () => void;
  onSaveDraft: () => void;
  /** Called only after the user confirms */
  onDiscardDraft: () => void;
  onSend: () => void;
}

const LABEL: Record<ComposerMode, string> = { reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' };

export function SendThanksInboxComposer(p: SendThanksInboxComposerProps) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const v = p.value, e = p.errors ?? {}, mobile = p.layout === 'mobile';
  const [showCc, setShowCc] = useState(!!v.cc);
  const [showBcc, setShowBcc] = useState(!!v.bcc);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (v.cc) setShowCc(true); }, [v.cc]);
  useEffect(() => { if (v.bcc) setShowBcc(true); }, [v.bcc]);
  useEffect(() => { if (!p.open) setConfirming(false); }, [p.open]);
  const keepRef = useRef<HTMLButtonElement>(null);
  const fieldRefs = useRef<Partial<Record<ComposerField, HTMLInputElement | HTMLTextAreaElement>>>({});
  useEffect(() => { if (confirming) keepRef.current?.focus(); }, [confirming]);
  useEffect(() => {
    const firstInvalid = (['to', 'cc', 'bcc', 'subject', 'body'] as const).find(key => e[key]);
    if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
  }, [e, showCc, showBcc]);

  const status = ({ new: 'Not saved yet', dirty: 'Unsaved changes', saving: 'Saving draft…', saved: `Draft saved${p.savedAtLabel ? ' ' + p.savedAtLabel : ''}`, error: 'Draft not saved. Try again.' } as const)[p.draftStatus];
  const hasDraft = p.draftStatus !== 'new';

  if (!p.open) {
    return hasDraft ? (
      <div className={`${styles.closed} ${mobile ? styles.m : ''}`}>
        <div className={styles.closedText}><span className={styles.strong}>{LABEL[v.mode]} draft</span>
          <span className={styles.muted}>{status} · To {splitRecipients(v.to).map(addressOf).join(', ') || 'no recipients yet'}</span></div>
        <button type="button" className={styles.btnPrimary} onClick={() => p.onOpen()}>Reopen draft</button>
      </div>
    ) : (
      <div role="toolbar" aria-label="Reply options" className={`${styles.openers} ${mobile ? styles.m : ''}`}>
        {(Object.keys(LABEL) as ComposerMode[]).map((m, i) => (
          <button key={m} type="button" className={i === 0 ? styles.btnPrimary : styles.btn} onClick={() => p.onOpen(m)}>{LABEL[m]}</button>))}
      </div>
    );
  }

  const field = (key: 'to' | 'cc' | 'bcc' | 'subject', label: string, hint?: string) => {
    const err = e[key], desc = [hint && id(key + '-hint'), err && id(key + '-err')].filter(Boolean).join(' ') || undefined;
    return (
      <div className={styles.row}>
        <label htmlFor={id(key)} className={styles.rowLabel}>{label}</label>
        <div className={styles.rowBody}>
          <input id={id(key)} name={key} ref={element => { if (element) fieldRefs.current[key] = element; else delete fieldRefs.current[key]; }} className={`${styles.control} ${err ? styles.invalid : ''}`} value={v[key]} autoComplete="off"
            inputMode={key === 'subject' ? 'text' : 'email'} spellCheck={key === 'subject'}
            placeholder={key === 'subject' ? 'Subject line…' : 'name@example.com, another@example.com…'}
            aria-invalid={!!err} aria-describedby={desc} onChange={ev => p.onChange({ [key]: ev.target.value })} />
          {hint && <span id={id(key + '-hint')} className={styles.hint}>{hint}</span>}
          {err && <span id={id(key + '-err')} role="alert" className={styles.error}>{err}</span>}
        </div>
      </div>
    );
  };

  const submit = (ev: FormEvent) => { ev.preventDefault(); if (!p.sending) p.onSend(); };

  return (
    <form className={`${styles.composer} ${mobile ? styles.m : ''}`} onSubmit={submit} noValidate aria-labelledby={id('title')}>
      <div className={styles.head}>
        <h2 id={id('title')} className={styles.title}>{LABEL[v.mode]}</h2>
        <span aria-live="polite" className={`${styles.status} ${p.draftStatus === 'saved' ? styles.statusSaved : ''}`}>{status}</span>
      </div>
      <div role="group" aria-label="Composer mode" className={styles.modes}>
        {(Object.keys(LABEL) as ComposerMode[]).map(m => (
          <button key={m} type="button" aria-pressed={v.mode === m} className={`${styles.mode} ${v.mode === m ? styles.on : ''}`} onClick={() => p.onModeChange(m)}>{LABEL[m]}</button>))}
      </div>

      <div className={styles.fields}>
        <div className={styles.row}>
          <label htmlFor={id('from')} className={styles.rowLabel}>From</label>
          <div className={styles.rowBody}>
            <select id={id('from')} name="from" className={styles.control} value={v.from} onChange={ev => p.onChange({ from: ev.target.value })}>
              {p.fromOptions.map(m => <option key={m.address} value={m.address}>{formatMailbox(m)}</option>)}
            </select>
          </div>
        </div>
        {field('to', 'To')}
        {showCc && field('cc', 'Cc')}
        {showBcc && field('bcc', 'Bcc', 'Bcc recipients are hidden from everyone else. Nobody is added here automatically.')}
        {field('subject', 'Subject')}
        {(!showCc || !showBcc) && (
          <div className={styles.reveal}>
            {!showCc && <button type="button" className={styles.textBtn} onClick={() => setShowCc(true)}>Add Cc</button>}
            {!showBcc && <button type="button" className={styles.textBtn} onClick={() => setShowBcc(true)}>Add Bcc</button>}
          </div>
        )}
      </div>

      <div className={styles.bodyField}>
        <label htmlFor={id('body')} className={styles.rowLabel}>Message <span className={styles.optional}>(plain text)</span></label>
        <textarea id={id('body')} name="body" ref={element => { if (element) fieldRefs.current.body = element; else delete fieldRefs.current.body; }} className={`${styles.control} ${styles.area} ${e.body ? styles.invalid : ''}`} rows={mobile ? 3 : 5} value={v.body} placeholder="Write your message…"
          aria-invalid={!!e.body} aria-describedby={e.body ? id('body-err') : undefined} onChange={ev => p.onChange({ body: ev.target.value })} />
        {e.body && <span id={id('body-err')} role="alert" className={styles.error}>{e.body}</span>}
      </div>

      {v.mode === 'forward' && (
        <figure className={styles.quote} aria-label="Forwarded message">
          <figcaption className={styles.mono}>FORWARDED MESSAGE · INCLUDED BELOW YOURS</figcaption>
          <dl className={styles.quoteMeta}>
            <dt>From</dt><dd>{formatMailbox(p.source.from)}</dd>
            <dt>Date</dt><dd>{p.source.sentAtLabel}</dd>
            <dt>Subject</dt><dd>{p.threadSubject}</dd>
            <dt>To</dt><dd>{p.source.to.map(formatMailbox).join(', ')}</dd>
          </dl>
          <blockquote className={styles.quoteText}>{p.source.text}</blockquote>
        </figure>
      )}

      {e.form && <div role="alert" className={styles.formError}>{e.form}</div>}

      {confirming ? (
        <div role="alertdialog" aria-labelledby={id('cf')} aria-describedby={id('cfd')} className={styles.confirm}>
          <div id={id('cf')} className={styles.strong}>Discard this draft?</div>
          <div id={id('cfd')}>Its recipients, subject and message will be deleted. This can’t be undone.</div>
          <div className={styles.pair}>
            <button ref={keepRef} type="button" className={styles.btn} onClick={() => setConfirming(false)}>Keep draft</button>
            <button type="button" className={styles.btnInk} onClick={() => { setConfirming(false); p.onDiscardDraft(); }}>Discard draft</button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="submit" className={`${styles.btnPrimary} ${styles.send}`} disabled={p.sending}>{p.sending ? 'Sending…' : 'Send'}</button>
          <button type="button" className={styles.btn} onClick={p.onSaveDraft} disabled={p.draftStatus === 'saved' || p.draftStatus === 'saving'}>Save draft</button>
          <button type="button" className={styles.btn} onClick={p.onClose}>Close</button>
          <button type="button" className={`${styles.btn} ${styles.discard}`} onClick={() => setConfirming(true)}>Discard draft</button>
        </div>
      )}
    </form>
  );
}

export default SendThanksInboxComposer;
