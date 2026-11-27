'use client';

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './shared-inbox-workspace.module.css';
import { SendThanksInboxComposer, type ComposerErrors, type ComposerMode, type ComposerValue, type DraftStatus } from './send-thanks-inbox-composer';

/* ---------- Serializable data contract ---------- */
export type FolderId = 'inbox' | 'sent' | 'archive' | 'spam' | 'trash';
export interface Mailbox { name?: string | null; address: string }
export interface InboxOption { id: string; address: string; name?: string | null }
export interface FolderSummary { id: FolderId; unreadCount?: number | null }
export interface InboxLabel { id: string; name: string }
export interface ThreadSummary {
  id: string; inboxId: string; folder: FolderId; subject: string;
  /** The external party shown in the row (sender for inbound, recipient for Sent) */
  counterpart: Mailbox;
  snippet: string; latestDirection: 'inbound' | 'outbound';
  lastMessageAt: string; unread: boolean; messageCount: number; labelIds: string[];
}
export interface ThreadMessage {
  id: string; direction: 'inbound' | 'outbound'; from: Mailbox; to: Mailbox[]; cc?: Mailbox[]; bcc?: Mailbox[];
  sentAt: string; /** Plain text. Sanitise and convert HTML on the server. */ text: string;
  replyTo?: Mailbox;
  htmlPreview?: string | null;
  attachments?: Array<{ id: string; filename: string; contentType: string; byteLength: number; downloadUrl: string }>;
}
export interface ThreadDetail {
  id: string; inboxId: string; folder: FolderId; subject: string; unread: boolean; labelIds: string[];
  counterpart: Mailbox; messages: ThreadMessage[]; /** oldest first */
}
type Status = 'loading' | 'ready' | 'error';

export interface SharedInboxWorkspaceProps {
  inboxes: InboxOption[];
  /** null = All inboxes */
  activeInboxId: string | null;
  folders: FolderSummary[];
  activeFolder: FolderId;
  labels: InboxLabel[];
  threads: ThreadSummary[];
  listStatus: Status;
  listError?: string | null;
  hasMore: boolean;
  loadingMore?: boolean;
  query: string;
  selectedThreadId: string | null;
  thread: ThreadDetail | null;
  threadStatus: Status | 'idle';
  threadError?: string | null;
  composerValue: ComposerValue;
  composerOpen: boolean;
  composerDraftStatus: DraftStatus;
  composerSavedAtLabel?: string | null;
  composerErrors?: ComposerErrors;
  composerSending?: boolean;
  onComposerChange: (patch: Partial<ComposerValue>) => void;
  onComposerModeChange: (mode: ComposerMode) => void;
  onComposerOpen: (mode?: ComposerMode) => void;
  onComposerClose: () => void;
  onSaveComposerDraft: () => void;
  onDiscardComposerDraft: () => void;
  onSendComposer: () => void;
  /** Shown in the unobtrusive receiving notice. Pass null to hide. */
  receivingNotice?: string | null;
  layout?: 'desktop' | 'mobile';
  timeZone?: string;
  locale?: string;
  now?: string;
  onSelectInbox: (inboxId: string | null) => void;
  onSelectFolder: (folder: FolderId) => void;
  onSearch: (query: string) => void;
  onSelectThread: (threadId: string | null) => void;
  onLoadMore: () => void | Promise<void>;
  onRetryList: () => void;
  onRetryThread: () => void;
  onMarkRead: (threadId: string, read: boolean) => Promise<void>;
  onArchive: (threadId: string) => Promise<void>;
  /** Required: moving out of Archive. Wire to a real endpoint or keep the button disabled via canMoveToInbox. */
  onMoveToInbox: (threadId: string) => Promise<void>;
  canMoveToInbox: boolean;
  onSpam: (threadId: string) => Promise<void>;
  onTrash: (threadId: string) => Promise<void>;
  onSetLabels: (threadId: string, labelIds: string[]) => Promise<void>;
}

const FOLDER_LABEL: Record<FolderId, string> = { inbox: 'Inbox', sent: 'Sent', archive: 'Archive', spam: 'Spam', trash: 'Trash' };
const EMPTY: Record<FolderId, [string, string]> = {
  inbox: ['Nothing in Inbox', 'New conversations sent to your addresses will show up here.'],
  sent: ['Nothing sent yet', 'Replies you send from here will be kept in Sent.'],
  archive: ['Archive is empty', 'Archive a conversation to tidy it out of Inbox without deleting it.'],
  spam: ['No spam', 'Anything marked as spam goes here, out of your way.'],
  trash: ['Trash is empty', 'Conversations you move to Trash show up here.'],
};
const I = {
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z', sent: 'M21 3L3 10.5l7 3 3 7zM10 13.5L21 3', archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  spam: 'M12 3l9 16H3zM12 10v4M12 17h.01', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  label: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01', reply: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4', search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  back: 'M15 6l-6 6 6 6', info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v5M12 8h.01', more: 'M7 12h10',
};
const Svg = ({ d, size = 16, className }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className ?? styles.svg}><path d={d} /></svg>
);
const who = (m: Mailbox) => (m.name ? `${m.name} <${m.address}>` : m.address);
const formatBytes = (value: number) => value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
const previewDocument = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"></head><body>${html}</body></html>`;

function useDates(locale: string, timeZone: string, now?: string) {
  return useMemo(() => {
    const tz = { timeZone };
    const fTime = new Intl.DateTimeFormat(locale, { ...tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const fKey = new Intl.DateTimeFormat('en-CA', { ...tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const fDay = new Intl.DateTimeFormat(locale, { ...tz, weekday: 'short', day: 'numeric', month: 'short' });
    const fDayY = new Intl.DateTimeFormat(locale, { ...tz, day: 'numeric', month: 'short', year: 'numeric' });
    const fFull = new Intl.DateTimeFormat(locale, { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    const n = now ? new Date(now) : new Date();
    const today = fKey.format(n), yday = fKey.format(new Date(n.getTime() - 864e5));
    const list = (iso: string) => { const d = new Date(iso), k = fKey.format(d); return k === today ? fTime.format(d) : k === yday ? 'Yesterday' : k.slice(0, 4) === today.slice(0, 4) ? fDay.format(d) : fDayY.format(d); };
    const msg = (iso: string) => { const d = new Date(iso), k = fKey.format(d); return `${k === today ? 'Today' : k === yday ? 'Yesterday' : fDay.format(d)}, ${fTime.format(d)}`; };
    const full = (iso: string) => fFull.format(new Date(iso));
    return { list, msg, full };
  }, [locale, timeZone, now]);
}

export function SharedInboxWorkspace(p: SharedInboxWorkspaceProps) {
  const { inboxes, activeInboxId, folders, activeFolder, labels, threads, listStatus, hasMore, loadingMore = false, query,
    selectedThreadId, thread, threadStatus, layout = 'desktop', timeZone = 'Australia/Sydney', locale = 'en-AU', now } = p;
  const mobile = layout === 'mobile';
  const uid = useId();
  const dates = useDates(locale, timeZone, now);
  const labelName = useMemo(() => new Map(labels.map(l => [l.id, l.name])), [labels]);
  const inboxAddr = (id: string) => inboxes.find(i => i.id === id)?.address ?? '';
  const folderTitle = FOLDER_LABEL[activeFolder];

  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => { setLabelsOpen(false); setMoreOpen(false); setActionError(''); }, [selectedThreadId]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setActionError('');
    try { await fn(); setNote(ok); } catch (e) { setActionError(e instanceof Error ? e.message : 'That didn’t work. Please try again.'); }
    finally { setBusy(false); }
  };

  /* Escape: close sheet/labels → composer → (phone) back to list */
  const escRef = useRef<() => void>(() => {});
  escRef.current = () => {
    if (moreOpen || labelsOpen) { setMoreOpen(false); setLabelsOpen(false); return; }
    if (p.composerOpen) { p.onComposerClose(); return; }
    if (mobile && selectedThreadId) p.onSelectThread(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') escRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Phone thread view: lock body scroll, focus Back, restore focus to the row on close */
  const backRef = useRef<HTMLButtonElement>(null);
  const phoneDialogRef = useRef<HTMLDivElement>(null);
  const phoneThreadOpen = mobile && !!selectedThreadId;
  useEffect(() => {
    if (!phoneThreadOpen) return;
    const prev = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; backRef.current?.focus();
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !phoneDialogRef.current) return;
      const focusable = phoneDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab);
    return () => { document.removeEventListener('keydown', onTab); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [phoneThreadOpen]);

  /* Arrow keys move between conversation rows */
  const listRef = useRef<HTMLUListElement>(null);
  const onListKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement); if (i < 0) return;
    e.preventDefault(); btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const submitSearch = (e: FormEvent) => { e.preventDefault(); p.onSearch(draft.trim()); };
  const clearSearch = () => { setDraft(''); p.onSearch(''); };
  const ready = listStatus === 'ready';
  const unreadN = folders.find(f => f.id === activeFolder)?.unreadCount ?? threads.filter(t => t.unread).length;

  /* ---------- thread actions ---------- */
  const th = threadStatus === 'ready' ? thread : null;
  const close = () => { if (mobile) p.onSelectThread(null); };
  const actions = th ? [
    { key: 'read', label: th.unread ? 'Mark as read' : 'Mark as unread', icon: I.mail,
      fn: () => run(() => p.onMarkRead(th.id, th.unread), th.unread ? 'Marked as read.' : 'Marked as unread.') },
    { key: 'labels', label: 'Labels', icon: I.label, fn: () => { setLabelDraft(th.labelIds.slice()); setMoreOpen(false); setLabelsOpen(o => mobile || !o); } },
    th.folder !== 'archive'
      ? { key: 'archive', label: 'Archive', icon: I.archive, fn: () => run(async () => { await p.onArchive(th.id); close(); }, `Moved “${th.subject}” to Archive.`) }
      : { key: 'inbox', label: 'Move to Inbox', icon: I.inbox, disabled: !p.canMoveToInbox, fn: () => run(async () => { await p.onMoveToInbox(th.id); close(); }, `Moved “${th.subject}” to Inbox.`) },
    th.folder !== 'spam' && { key: 'spam', label: 'Spam', icon: I.spam, fn: () => run(async () => { await p.onSpam(th.id); close(); }, `Moved “${th.subject}” to Spam.`) },
    th.folder !== 'trash' && { key: 'trash', label: 'Trash', icon: I.trash, fn: () => run(async () => { await p.onTrash(th.id); close(); }, `Moved “${th.subject}” to Trash.`) },
  ].filter(Boolean) as { key: string; label: string; icon: string; fn: () => void; disabled?: boolean }[] : [];
  const primaryMove = actions.find(a => a.key === 'archive' || a.key === 'inbox');

  const saveLabels = (e: FormEvent) => { e.preventDefault(); if (!th) return; const ids = labelDraft.slice();
    run(async () => { await p.onSetLabels(th.id, ids); setLabelsOpen(false); }, 'Labels saved.'); };

  /* ---------- pieces ---------- */
  const notice = p.receivingNotice === undefined ? 'New mail only arrives here while this account’s receiving connection is active.' : p.receivingNotice;

  const renderStates = () => (<>
    {listStatus === 'loading' && (
      <div className={styles.loading}><div role="status" className={styles.loadingText}>Loading conversations…</div>
        {['55%', '40%', '48%', '36%'].map((w, i) => <div key={i} className={styles.skel} aria-hidden="true"><div style={{ width: w }} /><div style={{ width: '72%' }} /></div>)}
      </div>
    )}
    {listStatus === 'error' && (
      <div role="alert" className={styles.error}><div className={styles.stateTitle}>Couldn’t load conversations</div>
        <div className={styles.stateBody}>{p.listError || 'Something went wrong while fetching this folder. Your mail is safe.'}</div>
        <button type="button" className={styles.btn} onClick={p.onRetryList}>Try again</button></div>
    )}
    {ready && threads.length === 0 && !query && (
      <div className={styles.empty}><div className={styles.stateTitle}>{EMPTY[activeFolder][0]}</div><div className={styles.stateMuted}>{EMPTY[activeFolder][1]}</div></div>
    )}
    {ready && threads.length === 0 && !!query && (
      <div className={styles.empty}><div className={styles.stateTitle}>No conversations match “{query}”</div>
        <div className={styles.stateMuted}>Try a name, an address or a word from the message.</div>
        <button type="button" className={styles.btn} onClick={clearSearch}>Clear search</button></div>
    )}
  </>);

  const renderRows = () => ready && threads.length > 0 && (<>
    <ul ref={listRef} aria-label={`${folderTitle} conversations`} className={styles.rows} onKeyDown={onListKey}>
      {threads.map(t => {
        const cur = !mobile && t.id === selectedThreadId;
        const date = dates.list(t.lastMessageAt);
        return (
          <li key={t.id} className={styles.rowItem}>
            <button type="button" data-row className={`${styles.row} ${cur ? styles.rowOn : ''} ${t.unread ? styles.rowUnread : ''}`}
              aria-current={cur || undefined} onClick={() => p.onSelectThread(t.id)}
              aria-label={`${t.unread ? 'Unread. ' : ''}${t.counterpart.name || t.counterpart.address}. ${t.subject}. ${date}`}>
              <span className={styles.rowTop}><span className={styles.sender}>{activeFolder === 'sent' ? 'To ' : ''}{t.counterpart.name || t.counterpart.address}</span>
                <time dateTime={t.lastMessageAt} title={dates.full(t.lastMessageAt)} className={styles.rowDate}>{date}</time></span>
              <span className={styles.rowSubject} title={t.subject}>{t.subject}</span>
              <span className={styles.rowSnippet}>{t.latestDirection === 'outbound' ? 'You: ' : ''}{t.snippet}</span>
              <span className={styles.rowTags}>
                {t.unread && <span className={`${styles.chip} ${styles.unread}`}>Unread</span>}
                {t.labelIds.map(id => labelName.get(id)).filter(Boolean).map(n => <span key={n} className={styles.chip}>{n}</span>)}
                {t.messageCount > 1 && <span className={styles.rowCount}>{t.messageCount} messages</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
    <div className={styles.listFoot}>
      {hasMore && <button type="button" className={styles.more} onClick={() => p.onLoadMore()} disabled={loadingMore} aria-busy={loadingMore}>{loadingMore ? 'Loading older conversations…' : 'Load older conversations'}</button>}
      {!hasMore && !query && <div className={styles.endText}>That’s everything in {folderTitle}.</div>}
    </div>
  </>);

  const renderLabels = () => (
    <form onSubmit={saveLabels} aria-label="Labels for this conversation" className={mobile ? styles.labelsSheet : styles.labelsPanel}>
      <fieldset className={styles.labelSet}><legend className={mobile ? styles.srOnly : styles.legend}>Labels</legend>
        {labels.map(l => { const c = labelDraft.includes(l.id); return (
          <label key={l.id} className={`${styles.labelOpt} ${c ? styles.labelOn : ''}`}>
            <input type="checkbox" checked={c} onChange={() => setLabelDraft(d => c ? d.filter(x => x !== l.id) : [...d, l.id])} />{l.name}
          </label>); })}
        {labels.length === 0 && <div className={styles.stateMuted}>No labels exist for this account yet.</div>}
      </fieldset>
      <div className={styles.btnRow}>
        <button type="submit" className={styles.btnTomato} disabled={busy}>Save labels</button>
        {!mobile && <button type="button" className={styles.btn} onClick={() => setLabelsOpen(false)}>Cancel</button>}
      </div>
    </form>
  );

  const renderMessages = () => {
    if (!th) return null;
    const msgs = th.messages, fold = msgs.length > 4 && !showAll[th.id];
    const view: (ThreadMessage | { gap: number })[] = fold ? [msgs[0], { gap: msgs.length - 3 }, ...msgs.slice(-2)] : msgs;
    return (
      <ol aria-label="Messages, oldest first" className={styles.timeline}>
        {view.map((m, i) => (
          <li key={'gap' in m ? 'gap' : m.id} className={styles.tItem}>
            <div className={styles.rail}>
              <span className={styles.spine} data-first={i === 0 || undefined} data-last={i === view.length - 1 || undefined} aria-hidden="true" />
              <span className={`${styles.tile} ${'gap' in m ? styles.tileGap : ''}`}><Svg d={'gap' in m ? I.more : m.direction === 'outbound' ? I.sent : I.inbox} /></span>
            </div>
            <div className={styles.tBody}>
              {'gap' in m ? (
                <button type="button" className={styles.gap} onClick={() => setShowAll(s => ({ ...s, [th.id]: true }))}>Show {m.gap} earlier messages</button>
              ) : (
                <article className={`${styles.msg} ${m.direction === 'outbound' ? styles.msgOut : ''}`}
                  aria-label={`${m.direction === 'outbound' ? 'Sent' : 'Received'} message from ${m.from.name || m.from.address}, ${dates.msg(m.sentAt)}`}>
                  <div className={styles.msgHead}>
                    <span className={styles.msgFrom}>{m.from.name || m.from.address}</span>
                    {!mobile && m.from.name && <span className={styles.msgAddr}>{m.from.address}</span>}
                    <span className={`${styles.chip} ${m.direction === 'outbound' ? styles.chipPaper : ''}`}>{m.direction === 'outbound' ? 'Sent' : 'Received'}</span>
                    {!mobile && <time dateTime={m.sentAt} title={dates.full(m.sentAt)} className={styles.msgTime}>{dates.msg(m.sentAt)}</time>}
                  </div>
                  {mobile
                    ? <div className={styles.msgMeta}>{m.from.address} · <time dateTime={m.sentAt} title={dates.full(m.sentAt)}>{dates.msg(m.sentAt)}</time></div>
                  : <div className={styles.msgMeta}>To {m.to.map(who).join(', ')}{m.cc?.length ? ` · Cc ${m.cc.map(who).join(', ')}` : ''}{m.bcc?.length ? ` · Bcc ${m.bcc.map(who).join(', ')}` : ''}</div>}
                  {m.text.split('\n').map((para, j) => <p key={j} className={styles.para}>{para}</p>)}
                  {!!m.htmlPreview && <details className={styles.formattedPreview}><summary>View formatted message</summary><iframe title={`Formatted message from ${m.from.name || m.from.address}`} sandbox="" srcDoc={previewDocument(m.htmlPreview)} /></details>}
                  {!!m.attachments?.length && <section className={styles.attachmentList} aria-label="Attachments"><strong>Attachments</strong><ul>{m.attachments.map(attachment => <li key={attachment.id}><span>{attachment.filename}<small>{attachment.contentType} · {formatBytes(attachment.byteLength)}</small></span><a href={attachment.downloadUrl} download>Download</a></li>)}</ul></section>}
                </article>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  };

  const renderComposer = () => {
    if (!th) return null;
    const sourceMessage = [...th.messages].reverse().find(message => message.direction === 'inbound');
    if (!sourceMessage) return <div role="status" className={styles.threadState}>Only conversations with received messages can be replied to.</div>;
    const fromOptions: Array<{ address: string; name?: string | null }> = inboxes.map(inbox => ({ address: inbox.address, name: inbox.name }));
    if (!fromOptions.some(inbox => inbox.address.toLowerCase() === th.inboxId.toLowerCase())) fromOptions.unshift({ address: th.inboxId });
    return <SendThanksInboxComposer
      value={p.composerValue}
      fromOptions={fromOptions}
      source={{ from: sourceMessage.from, to: sourceMessage.to, cc: sourceMessage.cc, replyTo: sourceMessage.replyTo, sentAtLabel: dates.msg(sourceMessage.sentAt), text: sourceMessage.text }}
      threadSubject={th.subject}
      open={p.composerOpen}
      draftStatus={p.composerDraftStatus}
      savedAtLabel={p.composerSavedAtLabel}
      errors={p.composerErrors}
      sending={p.composerSending}
      layout={layout}
      onChange={p.onComposerChange}
      onModeChange={p.onComposerModeChange}
      onOpen={p.onComposerOpen}
      onClose={p.onComposerClose}
      onSaveDraft={p.onSaveComposerDraft}
      onDiscardDraft={p.onDiscardComposerDraft}
      onSend={p.onSendComposer}
    />;
  };

  const renderThreadHead = () => th && (<>
    <h2 id={`${uid}-subject`} className={styles.subject}>{th.subject}</h2>
    <dl className={styles.meta}>
      <div><dt>With</dt><dd>{who(th.counterpart)}</dd></div>
      <div><dt>Inbox</dt><dd>{inboxAddr(th.inboxId)}</dd></div>
      <div><dt>Folder</dt><dd>{FOLDER_LABEL[th.folder]}</dd></div>
      <div><dt>Messages</dt><dd>{th.messages.length}</dd></div>
      {th.messages[0] && <div><dt>Started</dt><dd>{dates.msg(th.messages[0].sentAt)}</dd></div>}
    </dl>
    <div className={styles.tags}>
      {th.unread && <span className={`${styles.chipLg} ${styles.unread}`}>Unread</span>}
      {th.labelIds.map(id => labelName.get(id)).filter(Boolean).map(n => <span key={n} className={styles.chipLg}>{n}</span>)}
      {th.labelIds.length === 0 && !mobile && <span className={styles.muted}>No labels</span>}
    </div>
  </>);

  const renderThreadState = () => (<>
    {threadStatus === 'loading' && <div role="status" className={styles.threadState}>Loading conversation…</div>}
    {threadStatus === 'error' && (
      <div role="alert" className={styles.error}><div className={styles.stateTitle}>Couldn’t open this conversation</div>
        <div className={styles.stateBody}>{p.threadError || 'Something went wrong while fetching it. Nothing has changed.'}</div>
        <button type="button" className={styles.btn} onClick={p.onRetryThread}>Try again</button></div>
    )}
  </>);

  const feedback = (<>
    {note && <div role="status" className={styles.note}><span>{note}</span><button type="button" className={styles.btn} onClick={() => setNote('')}>OK</button></div>}
    {actionError && <div role="alert" className={styles.actionError}>{actionError}</div>}
  </>);

  const header = (
    <div className={styles.head}>
      <div className={styles.headText}><h1 className={styles.h1}>Receiving</h1><p className={styles.intro}>Mail sent to your addresses, grouped into conversations.</p></div>
      <label className={styles.inboxPick}><span className={styles.pickLabel}>Inbox</span>
        <select value={activeInboxId ?? ''} onChange={e => p.onSelectInbox(e.target.value || null)} className={styles.select}>
          <option value="">All inboxes</option>
          {inboxes.map(i => <option key={i.id} value={i.id}>{i.address}</option>)}
        </select>
      </label>
    </div>
  );
  const noticeEl = notice && <div className={styles.notice}><Svg d={I.info} size={18} className={styles.svgInk} /><span>{notice}</span></div>;

  const folderButtons = (
    <nav aria-label="Folders" className={mobile ? styles.foldersM : styles.folders}>
      {(['inbox', 'sent', 'archive', 'spam', 'trash'] as FolderId[]).map(id => {
        const cur = id === activeFolder, n = folders.find(f => f.id === id)?.unreadCount ?? 0;
        return (
          <button key={id} type="button" aria-current={cur ? 'page' : undefined} aria-label={`${FOLDER_LABEL[id]}${n ? `, ${n} unread` : ''}`}
            className={`${mobile ? styles.folderM : styles.folder} ${cur ? styles.on : ''}`} onClick={() => p.onSelectFolder(id)}>
            {!mobile && <Svg d={I[id]} size={20} />}
            <span className={styles.folderName}>{FOLDER_LABEL[id]}</span>
            <span className={styles.folderCount}>{n ? `${n} new` : mobile ? '\u00A0' : ''}</span>
          </button>
        );
      })}
    </nav>
  );

  const searchForm = (
    <form role="search" onSubmit={submitSearch} className={mobile ? styles.searchM : styles.search}>
      <div className={styles.searchRow}>
        <label className={styles.searchLabel}><span className={styles.srOnly}>Search conversations</span>
          <Svg d={I.search} size={18} className={styles.searchIcon} />
          <input type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder={mobile ? 'Search mail' : 'Search sender, subject or text'} className={styles.searchInput} aria-describedby={`${uid}-search-help`} />
        </label>
        {query && <button type="button" className={styles.btn} onClick={clearSearch}>Clear</button>}
      </div>
      <p id={`${uid}-search-help`} className={styles.searchHint}>Try from:, to:, subject:, before:, after:, or is:unread</p>
    </form>
  );

  const listMeta = ready ? `${unreadN} UNREAD · ${threads.length} SHOWN` : '';

  /* ---------- desktop ---------- */
  if (!mobile) return (
    <div className={styles.root}>
      {header}{noticeEl}{feedback}
      <div className={styles.bench}>
        {folderButtons}
        <section aria-label="Conversations" className={styles.listPane}>
          {searchForm}
          <div className={styles.listHead}><h2 className={styles.h2}>{folderTitle}</h2><span className={styles.mono}>{listMeta}</span></div>
          <div className={styles.scroll} aria-busy={listStatus === 'loading' || loadingMore}>{renderStates()}{renderRows()}</div>
        </section>
        <section aria-label="Conversation" aria-labelledby={th ? `${uid}-subject` : undefined} className={styles.detailPane}>
          {!selectedThreadId && (
            <div className={styles.placeholder}><Svg d={I.inbox} size={40} className={styles.svgThin} /><div className={styles.stateTitle}>No conversation open</div><div className={styles.stateMuted}>Pick one from the list to read it and reply.</div></div>
          )}
          {selectedThreadId && renderThreadState()}
          {th && (<>
            <div className={styles.detailHead}>
              {renderThreadHead()}
              <div role="toolbar" aria-label="Conversation actions" className={styles.toolbar}>
                {actions.map(a => (
                  <button key={a.key} type="button" className={`${styles.btn} ${a.key === 'labels' && labelsOpen ? styles.on : ''}`} onClick={a.fn}
                    disabled={busy || a.disabled} aria-expanded={a.key === 'labels' ? labelsOpen : undefined}><Svg d={a.icon} />{a.label}</button>
                ))}
              </div>
              {labelsOpen && renderLabels()}
            </div>
            <div className={styles.messages}>{renderMessages()}</div>
            {renderComposer()}
          </>)}
        </section>
      </div>
    </div>
  );

  /* ---------- phone ---------- */
  return (
    <div className={styles.rootM}>
      {header}{noticeEl}{feedback}
      {folderButtons}
      {searchForm}
      <section aria-label="Conversations" aria-busy={listStatus === 'loading' || loadingMore} className={styles.listCardM}>
        <div className={styles.listHeadM}><h2 className={styles.h2}>{folderTitle}</h2><span className={styles.mono}>{listMeta}</span></div>
        {renderStates()}{renderRows()}
      </section>

      {phoneThreadOpen && (
        <div ref={phoneDialogRef} role="dialog" aria-modal="true" aria-label={th?.subject ?? 'Conversation'} className={styles.threadM}>
          <div className={styles.topBarM}>
            <button ref={backRef} type="button" className={styles.backM} onClick={() => p.onSelectThread(null)} aria-label={`Back to ${folderTitle}`}><Svg d={I.back} size={20} className={styles.svgBold} />{folderTitle}</button>
            {th && <span className={styles.mono}>{th.messages.length} {th.messages.length === 1 ? 'MESSAGE' : 'MESSAGES'}</span>}
          </div>
          <div className={styles.threadBodyM}>
            {feedback}
            {renderThreadState()}
            {th && (<>{renderThreadHead()}{renderMessages()}{renderComposer()}</>)}
          </div>
          {th && !p.composerOpen && (
            <div role="toolbar" aria-label="Conversation actions" className={styles.actionBarM}>
              {primaryMove && <button type="button" className={styles.btn} onClick={primaryMove.fn} disabled={busy || primaryMove.disabled}>{primaryMove.label}</button>}
              <button type="button" className={styles.btn} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>More</button>
            </div>
          )}
          {th && (moreOpen || labelsOpen) && (
            <div className={styles.sheetWrap}>
              <button type="button" className={styles.scrim} aria-label="Close conversation actions" onClick={() => { setMoreOpen(false); setLabelsOpen(false); }} />
              <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-sheet`} className={styles.sheet}>
                <div className={styles.grab} aria-hidden="true" />
                <div className={styles.sheetHead}><h3 id={`${uid}-sheet`} className={styles.sheetTitle}>{labelsOpen && !moreOpen ? 'Labels' : 'More actions'}</h3>
                  <button type="button" className={styles.btn} onClick={() => { setMoreOpen(false); setLabelsOpen(false); }}>Cancel</button></div>
                {moreOpen && actions.filter(a => a !== primaryMove).map(a => (
                  <button key={a.key} type="button" className={styles.sheetAction} disabled={busy || a.disabled}
                    onClick={() => { if (a.key !== 'labels') setMoreOpen(false); a.fn(); }}><Svg d={a.icon} size={20} />{a.label}</button>
                ))}
                {labelsOpen && !moreOpen && renderLabels()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SharedInboxWorkspace;
