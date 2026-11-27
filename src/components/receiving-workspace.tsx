'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SharedInboxWorkspace,
  type FolderId,
  type InboxLabel,
  type InboxOption,
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
} from '@/components/shared-inbox-workspace';
import { addressOf, recipientsFor, splitRecipients, subjectFor, validateComposer, type ComposerMode, type ComposerValue, type DraftStatus } from '@/components/send-thanks-inbox-composer';

type Mailbox = { name?: string; address: string };
type InboxListRow = {
  id: string; inbox_id: string; folder: FolderId; subject: string; counterpart: Mailbox; snippet: string;
  latest_direction: 'inbound' | 'outbound'; updated_at: string; unread: boolean; message_count: number; labels: string[];
};
type InboxListResponse = {
  data: InboxListRow[];
  inboxes: InboxOption[];
  folders: Array<{ id: FolderId; unreadCount: number }>;
  labels: InboxLabel[];
  has_more: boolean;
  next_after?: string;
};
type InboxThreadResponse = {
  id: string; inbox_id: string; folder: FolderId; subject: string; unread: boolean; labels: string[];
  counterpart: Mailbox;
  messages: Array<{
    id: string; direction: 'inbound' | 'outbound'; from: Mailbox; to: Mailbox[]; cc?: Mailbox[]; bcc?: Mailbox[];
    reply_to?: Mailbox;
    sent_at: string; text: string; html_preview?: string | null;
    attachments?: Array<{ id: string; filename: string; content_type: string; byte_length: number; download_url: string }>;
  }>;
};
type InboxDraftResponse = {
  draft: null | { mode: 'reply' | 'reply_all' | 'forward'; from: string; to: string; cc: string; bcc: string; subject: string; text: string; updated_at: string };
};

const emptyComposerValue: ComposerValue = { mode: 'reply', from: '', to: '', cc: '', bcc: '', subject: '', body: '' };

function composeModeFromStorage(mode: 'reply' | 'reply_all' | 'forward'): ComposerMode {
  return mode === 'reply_all' ? 'replyAll' : mode;
}

function composeModeForApi(mode: ComposerMode) {
  return mode === 'replyAll' ? 'reply_all' : mode;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as { error?: { message?: unknown } | string };
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(typeof message === 'string' ? message : `Request failed (${response.status}).`);
  }
  return data as T;
}

function mapMessage(message: InboxThreadResponse['messages'][number]): ThreadMessage {
  return {
    id: message.id,
    direction: message.direction,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.reply_to,
    sentAt: message.sent_at,
    text: message.text,
    htmlPreview: message.html_preview,
    attachments: message.attachments?.map(attachment => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      byteLength: attachment.byte_length,
      downloadUrl: attachment.download_url,
    })),
  };
}

function mapThread(value: InboxThreadResponse): ThreadDetail {
  return {
    id: value.id,
    inboxId: value.inbox_id,
    folder: value.folder,
    subject: value.subject,
    unread: value.unread,
    labelIds: value.labels,
    counterpart: value.counterpart,
    messages: value.messages.map(mapMessage),
  };
}

function defaultComposer(thread: ThreadDetail, mode: ComposerMode = 'reply'): ComposerValue {
  const source = [...thread.messages].reverse().find(message => message.direction === 'inbound');
  const from = thread.inboxId || '';
  const sourceForComposer = source ? {
    from: source.from,
    to: source.to,
    cc: source.cc,
    replyTo: source.replyTo,
    sentAtLabel: source.sentAt,
    text: source.text,
  } : null;
  const recipients = sourceForComposer ? recipientsFor(mode, sourceForComposer, from) : { to: '', cc: '' };
  return { mode, from, ...recipients, bcc: '', subject: subjectFor(mode, thread.subject), body: '' };
}

function savedTimeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function ReceivingWorkspace() {
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [folders, setFolders] = useState<Array<{ id: FolderId; unreadCount: number }>>([]);
  const [labels, setLabels] = useState<InboxLabel[]>([]);
  const [activeInboxId, setActiveInboxId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<FolderId>('inbox');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextAfter, setNextAfter] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [threadStatus, setThreadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [threadError, setThreadError] = useState('');
  const [composerValue, setComposerValue] = useState<ComposerValue>(emptyComposerValue);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDraftStatus, setComposerDraftStatus] = useState<DraftStatus>('new');
  const composerDraftStatusRef = useRef<DraftStatus>('new');
  const [composerSavedAtLabel, setComposerSavedAtLabel] = useState<string | null>(null);
  const [composerErrors, setComposerErrors] = useState<ReturnType<typeof validateComposer>>({});
  const [composerSending, setComposerSending] = useState(false);
  const composerValueRef = useRef<ComposerValue>(emptyComposerValue);
  const composerRevisionRef = useRef(0);
  const draftSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const selectedThreadIdRef = useRef<string | null>(null);
  const discardInProgressRef = useRef(false);
  const navigationPendingRef = useRef(false);
  const sendIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [threadRetry, setThreadRetry] = useState(0);
  const [layout, setLayout] = useState<'desktop' | 'mobile'>('desktop');
  const [now] = useState(() => new Date().toISOString());
  const listRequest = useRef(0);

  const updateDraftStatus = useCallback((status: DraftStatus) => {
    composerDraftStatusRef.current = status;
    setComposerDraftStatus(status);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 759px)');
    const update = () => setLayout(media.matches ? 'mobile' : 'desktop');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const loadList = useCallback(async (append = false, after = '') => {
    const requestId = ++listRequest.current;
    if (append) setLoadingMore(true);
    else { setListStatus('loading'); setListError(''); }
    try {
      const params = new URLSearchParams({ folder: activeFolder, limit: '30' });
      if (query) params.set('search', query);
      if (activeInboxId) params.set('inbox', activeInboxId);
      if (append && after) params.set('after', after);
      const result = await api<InboxListResponse>(`/api/receiving/threads?${params}`);
      if (requestId !== listRequest.current) return;
      const page = result.data.map(row => ({
        id: row.id,
        inboxId: row.inbox_id,
        folder: row.folder,
        subject: row.subject,
        counterpart: row.counterpart,
        snippet: row.snippet,
        latestDirection: row.latest_direction,
        lastMessageAt: row.updated_at,
        unread: row.unread,
        messageCount: row.message_count,
        labelIds: row.labels,
      } satisfies ThreadSummary));
      setThreads(current => append ? [...current, ...page] : page);
      setInboxes(result.inboxes);
      setFolders(result.folders);
      setLabels(result.labels);
      setHasMore(result.has_more);
      setNextAfter(result.next_after ?? '');
      setListStatus('ready');
      setListError('');
    } catch (cause) {
      if (requestId !== listRequest.current) return;
      setListStatus('error');
      setListError(cause instanceof Error ? cause.message : 'Something went wrong while fetching this folder.');
    } finally {
      if (requestId === listRequest.current) setLoadingMore(false);
    }
  }, [activeFolder, activeInboxId, query]);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    if (!selectedThreadId) {
      setThread(null);
      setThreadStatus('idle');
      setThreadError('');
      composerRevisionRef.current += 1;
      composerValueRef.current = emptyComposerValue;
      setComposerValue(emptyComposerValue);
      setComposerOpen(false);
      updateDraftStatus('new');
      setComposerSavedAtLabel(null);
      setComposerErrors({});
      return;
    }
    let active = true;
    composerRevisionRef.current += 1;
    composerValueRef.current = emptyComposerValue;
    setComposerValue(emptyComposerValue);
    setComposerOpen(false);
    updateDraftStatus('new');
    setComposerSavedAtLabel(null);
    setComposerErrors({});
    setThreadStatus('loading');
    setThreadError('');
    api(`/api/receiving/threads/${encodeURIComponent(selectedThreadId)}`, { method: 'PATCH', body: JSON.stringify({ is_read: true }) })
      .then(() => Promise.all([
        api<InboxThreadResponse>(`/api/receiving/threads/${encodeURIComponent(selectedThreadId)}`),
        api<InboxDraftResponse>(`/api/receiving/threads/${encodeURIComponent(selectedThreadId)}/draft`),
      ]))
      .then(([value, saved]) => {
        if (!active) return;
        const mapped = mapThread(value);
        setThread(mapped);
        if (saved.draft) {
          const restored: ComposerValue = {
            mode: composeModeFromStorage(saved.draft.mode),
            from: saved.draft.from || mapped.inboxId,
            to: saved.draft.to,
            cc: saved.draft.cc,
            bcc: saved.draft.bcc,
            subject: saved.draft.subject,
            body: saved.draft.text,
          };
          composerValueRef.current = restored;
          setComposerValue(restored);
          updateDraftStatus('saved');
          setComposerSavedAtLabel(savedTimeLabel(saved.draft.updated_at));
        } else {
          const initial = defaultComposer(mapped);
          composerValueRef.current = initial;
          setComposerValue(initial);
        }
        setThreadStatus('ready');
        void loadList();
      })
      .catch(cause => {
        if (!active) return;
        setThreadStatus('error');
        setThreadError(cause instanceof Error ? cause.message : 'Something went wrong while opening this conversation.');
      });
    return () => { active = false; };
  }, [selectedThreadId, threadRetry, loadList, updateDraftStatus]);

  const persistDraft = useCallback(async (threadId: string, snapshot: ComposerValue, revision: number): Promise<boolean> => {
    const save = draftSaveQueueRef.current.catch(() => undefined).then(async () => {
      if (discardInProgressRef.current) return false;
      if (selectedThreadIdRef.current === threadId && composerRevisionRef.current === revision) updateDraftStatus('saving');
      try {
        const result = await api<InboxDraftResponse>(`/api/receiving/threads/${encodeURIComponent(threadId)}/draft`, {
          method: 'PUT', body: JSON.stringify({
            mode: composeModeForApi(snapshot.mode), from: snapshot.from,
            to: snapshot.to, cc: snapshot.cc, bcc: snapshot.bcc, subject: snapshot.subject, text: snapshot.body,
          }),
        });
        if (selectedThreadIdRef.current === threadId && composerRevisionRef.current === revision) {
          updateDraftStatus('saved');
          setComposerSavedAtLabel(result.draft ? savedTimeLabel(result.draft.updated_at) : null);
          setComposerErrors({});
        }
        return true;
      } catch (cause) {
        if (selectedThreadIdRef.current === threadId && composerRevisionRef.current === revision) {
          updateDraftStatus('error');
          setComposerErrors({ form: cause instanceof Error ? cause.message : 'Could not save this draft.' });
        }
        return false;
      }
    });
    draftSaveQueueRef.current = save;
    return save;
  }, [updateDraftStatus]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || composerDraftStatus !== 'dirty') return;
    const snapshot = composerValue;
    const revision = composerRevisionRef.current;
    const timer = window.setTimeout(() => { void persistDraft(selectedThreadId, snapshot, revision); }, 1200);
    return () => window.clearTimeout(timer);
  }, [selectedThreadId, composerDraftStatus, composerValue, persistDraft]);

  useEffect(() => {
    if (!['dirty', 'saving', 'error'].includes(composerDraftStatus)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [composerDraftStatus]);

  const refreshThread = useCallback(async (id: string) => {
    const value = await api<InboxThreadResponse>(`/api/receiving/threads/${encodeURIComponent(id)}`);
    const mapped = mapThread(value);
    if (id === selectedThreadId) {
      setThread(mapped);
      setThreadStatus('ready');
      setThreadError('');
    }
  }, [selectedThreadId]);

  const updateThread = useCallback(async (id: string, body: Record<string, unknown>, readThread = true) => {
    await api(`/api/receiving/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadList();
    if (readThread) await refreshThread(id);
    else if (thread?.id === id && typeof body.is_read === 'boolean') {
      setThread(current => current?.id === id ? { ...current, unread: !body.is_read } : current);
    }
  }, [loadList, refreshThread, thread?.id]);

  const navigateWithDraftSave = useCallback(async (navigate: () => void) => {
    if (navigationPendingRef.current || composerSending) return;
    navigationPendingRef.current = true;
    try {
      const threadId = selectedThreadIdRef.current;
      while (threadId && ['dirty', 'saving', 'error'].includes(composerDraftStatusRef.current)) {
        const revision = composerRevisionRef.current;
        const saved = await persistDraft(threadId, composerValueRef.current, revision);
        if (!saved) return;
        if (revision === composerRevisionRef.current && composerDraftStatusRef.current === 'saved') break;
      }
      navigate();
    } finally {
      navigationPendingRef.current = false;
    }
  }, [composerSending, persistDraft]);

  const selectThread = (id: string | null) => { void navigateWithDraftSave(() => { selectedThreadIdRef.current = id; setSelectedThreadId(id); }); };
  const selectFolder = (id: FolderId) => { void navigateWithDraftSave(() => { selectedThreadIdRef.current = null; setSelectedThreadId(null); setActiveFolder(id); }); };
  const selectInbox = (id: string | null) => { void navigateWithDraftSave(() => { selectedThreadIdRef.current = null; setSelectedThreadId(null); setActiveInboxId(id); }); };

  const changeComposer = (patch: Partial<ComposerValue>) => {
    const next = { ...composerValueRef.current, ...patch };
    composerValueRef.current = next;
    composerRevisionRef.current += 1;
    setComposerValue(next);
    updateDraftStatus('dirty');
    setComposerErrors({});
  };

  const changeComposerMode = (mode: ComposerMode) => {
    if (!thread) return;
    const next = { ...defaultComposer(thread, mode), from: composerValueRef.current.from, body: composerValueRef.current.body };
    composerValueRef.current = next;
    composerRevisionRef.current += 1;
    setComposerValue(next);
    updateDraftStatus('dirty');
    setComposerErrors({});
  };

  const openComposer = (mode?: ComposerMode) => {
    if (mode && thread && composerDraftStatus === 'new') {
      const next = defaultComposer(thread, mode);
      composerValueRef.current = next;
      composerRevisionRef.current += 1;
      setComposerValue(next);
      updateDraftStatus('dirty');
    }
    setComposerOpen(true);
  };

  const saveCurrentDraft = () => {
    if (!selectedThreadId || composerDraftStatus === 'new' || composerDraftStatus === 'saved' || composerDraftStatus === 'saving') return;
    void persistDraft(selectedThreadId, composerValueRef.current, composerRevisionRef.current);
  };

  const closeComposer = () => {
    if (selectedThreadId && composerDraftStatus === 'dirty') void persistDraft(selectedThreadId, composerValueRef.current, composerRevisionRef.current);
    setComposerOpen(false);
  };

  const discardComposerDraft = async () => {
    if (!selectedThreadId || !thread) return;
    const threadId = selectedThreadId;
    discardInProgressRef.current = true;
    composerRevisionRef.current += 1;
    await draftSaveQueueRef.current.catch(() => undefined);
    try {
      await api(`/api/receiving/threads/${encodeURIComponent(threadId)}/draft`, { method: 'DELETE' });
      const initial = defaultComposer(thread);
      composerValueRef.current = initial;
      setComposerValue(initial);
      setComposerOpen(false);
      updateDraftStatus('new');
      setComposerSavedAtLabel(null);
      setComposerErrors({});
    } catch (cause) {
      setComposerErrors({ form: cause instanceof Error ? cause.message : 'Could not discard this draft.' });
      updateDraftStatus('error');
    } finally {
      discardInProgressRef.current = false;
    }
  };

  const sendComposer = async () => {
    if (!selectedThreadId || composerSending) return;
    const value = composerValueRef.current;
    const errors = validateComposer(value);
    if (Object.keys(errors).length) { setComposerErrors(errors); return; }
    const threadId = selectedThreadId;
    setComposerSending(true);
    setComposerErrors({});
    try {
      if (composerDraftStatus === 'dirty' || composerDraftStatus === 'saving') {
        await persistDraft(threadId, value, composerRevisionRef.current);
      }
      await draftSaveQueueRef.current.catch(() => undefined);
      const request = {
        mode: composeModeForApi(value.mode), from: value.from,
        to: splitRecipients(value.to).map(addressOf),
        cc: splitRecipients(value.cc).map(addressOf),
        bcc: splitRecipients(value.bcc).map(addressOf),
        subject: value.subject, text: value.body,
      };
      const fingerprint = JSON.stringify(request);
      if (!sendIdempotencyRef.current || sendIdempotencyRef.current.fingerprint !== fingerprint) {
        sendIdempotencyRef.current = { fingerprint, key: window.crypto.randomUUID() };
      }
      await api(`/api/receiving/threads/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST', headers: { 'Idempotency-Key': sendIdempotencyRef.current.key }, body: JSON.stringify(request),
      });
      discardInProgressRef.current = true;
      composerRevisionRef.current += 1;
      await api(`/api/receiving/threads/${encodeURIComponent(threadId)}/draft`, { method: 'DELETE' });
      if (selectedThreadIdRef.current === threadId) {
        const initial = thread ? defaultComposer(thread) : emptyComposerValue;
        composerValueRef.current = initial;
        setComposerValue(initial);
        setComposerOpen(false);
        updateDraftStatus('new');
        setComposerSavedAtLabel(null);
        setComposerErrors({});
      }
      sendIdempotencyRef.current = null;
      await loadList();
      await refreshThread(threadId);
    } catch (cause) {
      setComposerErrors({ form: cause instanceof Error ? cause.message : 'Could not send this message.' });
    } finally {
      discardInProgressRef.current = false;
      setComposerSending(false);
    }
  };

  return <SharedInboxWorkspace
    inboxes={inboxes}
    activeInboxId={activeInboxId}
    folders={folders}
    activeFolder={activeFolder}
    labels={labels}
    threads={threads}
    listStatus={listStatus}
    listError={listError}
    hasMore={hasMore}
    loadingMore={loadingMore}
    query={query}
    selectedThreadId={selectedThreadId}
    thread={thread}
    threadStatus={threadStatus}
    threadError={threadError}
    composerValue={composerValue}
    composerOpen={composerOpen}
    composerDraftStatus={composerDraftStatus}
    composerSavedAtLabel={composerSavedAtLabel}
    composerErrors={composerErrors}
    composerSending={composerSending}
    onComposerChange={changeComposer}
    onComposerModeChange={changeComposerMode}
    onComposerOpen={openComposer}
    onComposerClose={closeComposer}
    onSaveComposerDraft={saveCurrentDraft}
    onDiscardComposerDraft={() => { void discardComposerDraft(); }}
    onSendComposer={() => { void sendComposer(); }}
    layout={layout}
    now={now}
    receivingNotice="New mail arrives here while your account’s receiving connection is active."
    canMoveToInbox
    onSelectInbox={selectInbox}
    onSelectFolder={selectFolder}
    onSearch={value => { void navigateWithDraftSave(() => { selectedThreadIdRef.current = null; setSelectedThreadId(null); setQuery(value); }); }}
    onSelectThread={selectThread}
    onLoadMore={() => loadList(true, nextAfter)}
    onRetryList={() => { void loadList(); }}
    onRetryThread={() => setThreadRetry(value => value + 1)}
    onMarkRead={(id, read) => updateThread(id, { is_read: read }, false)}
    onArchive={id => updateThread(id, { folder: 'archive' })}
    onMoveToInbox={id => updateThread(id, { folder: 'inbox' })}
    onSpam={id => updateThread(id, { folder: 'spam' })}
    onTrash={id => updateThread(id, { folder: 'trash' })}
    onSetLabels={(id, labelIds) => updateThread(id, { labels: labelIds })}
  />;
}
