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
    sent_at: string; text: string; html_preview?: string | null;
    attachments?: Array<{ id: string; filename: string; content_type: string; byte_length: number; download_url: string }>;
  }>;
};

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
  const [threadRetry, setThreadRetry] = useState(0);
  const [layout, setLayout] = useState<'desktop' | 'mobile'>('desktop');
  const [now] = useState(() => new Date().toISOString());
  const listRequest = useRef(0);

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
      return;
    }
    let active = true;
    setThreadStatus('loading');
    setThreadError('');
    api(`/api/receiving/threads/${encodeURIComponent(selectedThreadId)}`, { method: 'PATCH', body: JSON.stringify({ is_read: true }) })
      .then(() => api<InboxThreadResponse>(`/api/receiving/threads/${encodeURIComponent(selectedThreadId)}`))
      .then(value => {
        if (!active) return;
        setThread(mapThread(value));
        setThreadStatus('ready');
        void loadList();
      })
      .catch(cause => {
        if (!active) return;
        setThreadStatus('error');
        setThreadError(cause instanceof Error ? cause.message : 'Something went wrong while opening this conversation.');
      });
    return () => { active = false; };
  }, [selectedThreadId, threadRetry, loadList]);

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

  const selectThread = (id: string | null) => setSelectedThreadId(id);
  const selectFolder = (id: FolderId) => { setSelectedThreadId(null); setActiveFolder(id); };
  const selectInbox = (id: string | null) => { setSelectedThreadId(null); setActiveInboxId(id); };

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
    layout={layout}
    now={now}
    receivingNotice="New mail arrives here while your account’s receiving connection is active."
    canMoveToInbox
    onSelectInbox={selectInbox}
    onSelectFolder={selectFolder}
    onSearch={value => { setSelectedThreadId(null); setQuery(value); }}
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
    onReply={async ({ threadId, text }) => {
      await api(`/api/receiving/threads/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST',
        headers: { 'Idempotency-Key': window.crypto.randomUUID() },
        body: JSON.stringify({ text }),
      });
      await loadList();
      await refreshThread(threadId);
    }}
  />;
}
