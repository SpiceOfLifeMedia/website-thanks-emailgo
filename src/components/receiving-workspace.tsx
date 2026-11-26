'use client';

import { useCallback, useEffect, useState } from 'react';

type ReceivedSummary = { id: string; from_address: string; to: string[]; subject: string; message_id: string | null; received_at: string };
type ReceivedDetail = { id: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; message_id?: string; headers?: Record<string, string>; text?: string; html?: string; attachments: Array<{ id: string; filename: string; content_type: string; byte_length: number; download_url: string }>; received_at: string };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${response.status})`);
  return data as T;
}

function date(value: string) {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function previewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"></head><body>${html}</body></html>`;
}

export function ReceivingWorkspace() {
  const [rows, setRows] = useState<ReceivedSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextAfter, setNextAfter] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ReceivedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (append = false, after = '') => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (append && after) params.set('after', after);
      const result = await api<{ data: ReceivedSummary[]; total: number; has_more: boolean; next_after?: string }>(`/api/receiving?${params}`);
      setRows((current) => append ? [...current, ...result.data] : result.data);
      setTotal(result.total);
      setHasMore(result.has_more);
      setNextAfter(result.next_after ?? '');
      if (!append) setSelectedId((current) => current && result.data.some((row) => row.id === current) ? current : result.data[0]?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load received email.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    setDetailLoading(true);
    api<ReceivedDetail>(`/api/receiving/${encodeURIComponent(selectedId)}`)
      .then((value) => { if (active) { setDetail(value); setError(''); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load received email details.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  return <>
    <div className="pageHeading receivingHeading"><div><div className="eyebrow">INBOUND EMAIL</div><h1>Receiving</h1><p>Inspect email forwarded from your configured receiving provider.</p></div><button className="outlineButton" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    <div className="receivingNotice"><strong>Provider connection required</strong><span>Emailgo stores messages forwarded to its signed receiving endpoint. It does not host inbound SMTP or manage MX records.</span></div>
    {error && <p className="inlineError receivingError" role="alert">{error}</p>}
    <section className="receivingLayout" aria-label="Received email inbox">
      <div className="panel receivingList">
        <div className="panelHeader"><div><h2>Inbox</h2><p>{total} received {total === 1 ? 'message' : 'messages'}</p></div></div>
        <div className="receivingRows" aria-live="polite">
          {rows.map((row) => <button className={`receivedRow ${selectedId === row.id ? 'selected' : ''}`} key={row.id} onClick={() => setSelectedId(row.id)} aria-current={selectedId === row.id ? 'true' : undefined}>
            <span className="receivedRowTop"><strong>{row.from_address}</strong><time dateTime={row.received_at}>{date(row.received_at)}</time></span>
            <span className="receivedSubject">{row.subject || '(no subject)'}</span>
            <span className="receivedRecipient">To {row.to.join(', ')}</span>
          </button>)}
          {!rows.length && <div className="emptyPanel">{loading ? 'Loading received messages…' : error ? 'The inbox is unavailable.' : 'No email has arrived yet.'}</div>}
        </div>
        {hasMore && <div className="receivingListFooter"><button className="outlineButton" onClick={() => void load(true, nextAfter)} disabled={loading}>{loading ? 'Loading…' : 'Load older messages'}</button></div>}
      </div>
      <article className="panel receivedDetail" aria-live="polite">
        {detailLoading && <div className="emptyPanel">Loading message…</div>}
        {!detailLoading && !detail && <div className="emptyPanel">Choose a message to view its contents.</div>}
        {detail && <>
          <header className="receivedDetailHeader"><div className="eyebrow">RECEIVED MESSAGE</div><h2>{detail.subject || '(no subject)'}</h2><time dateTime={detail.received_at}>{date(detail.received_at)}</time></header>
          <dl className="emailDetailMeta"><div><dt>From</dt><dd>{detail.from}</dd></div><div><dt>To</dt><dd>{detail.to.join(', ')}</dd></div>{detail.cc?.length ? <div><dt>Cc</dt><dd>{detail.cc.join(', ')}</dd></div> : null}{detail.bcc?.length ? <div><dt>Bcc</dt><dd>{detail.bcc.join(', ')}</dd></div> : null}{detail.message_id && <div><dt>Message ID</dt><dd><code>{detail.message_id}</code></dd></div>}</dl>
          {detail.text && <section className="emailDetailSection"><h3>Plain text</h3><pre>{detail.text}</pre></section>}
          {detail.html && <section className="emailDetailSection"><h3>HTML preview</h3><iframe title="Received email HTML preview" sandbox="" srcDoc={previewDocument(detail.html)} /></section>}
          {detail.attachments.length > 0 && <section className="emailDetailSection"><h3>Attachments</h3><ul className="receivedAttachments">{detail.attachments.map((attachment) => <li key={attachment.id}><span>{attachment.filename}<small>{attachment.content_type} · {formatBytes(attachment.byte_length)}</small></span><a className="outlineButton" href={attachment.download_url}>Download</a></li>)}</ul></section>}
        </>}
      </article>
    </section>
  </>;
}

function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}
