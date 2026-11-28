'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Log = {
  id: string;
  object: 'log';
  created_at: string;
  endpoint: string;
  method: string;
  response_status: number;
  user_agent: string | null;
  request_bytes: number | null;
  response_bytes: number | null;
  api_key?: { name: string | null; prefix: string | null };
  request_body?: Record<string, unknown> | unknown[] | null;
  response_body?: Record<string, unknown> | unknown[] | null;
};

type ListResult = { data: Log[]; total: number; has_more: boolean; next_after?: string };

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `Request failed (${response.status})`);
  return body as T;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function bodyText(value: unknown) {
  if (value === null || value === undefined) return 'No JSON body was captured.';
  try { return JSON.stringify(value, null, 2); } catch { return 'Body is unavailable.'; }
}

function formatBytes(value: number | null) {
  if (value === null) return 'Unknown';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function fromDomain(log: Log) {
  const from = Array.isArray(log.request_body) ? undefined : log.request_body?.from;
  if (typeof from !== 'string') return null;
  const email = from.match(/<([^<>]+)>/)?.[1] ?? from;
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() : null;
}

export function RequestLogsWorkspace() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [total, setTotal] = useState(0);
  const [nextAfter, setNextAfter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Log | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [show403Help, setShow403Help] = useState(false);
  const [copied, setCopied] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef(0);

  const load = useCallback(async ({ append = false, after = '' }: { append?: boolean; after?: string } = {}) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    if (!append) setLogs([]);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (append && after) params.set('after', after);
      const result = await loadJson<ListResult>(`/api/logs?${params}`);
      if (requestId !== requestRef.current) return;
      setLogs((current) => append ? [...current, ...result.data] : result.data);
      setTotal(result.total);
      setNextAfter(result.next_after ?? '');
    } catch (cause) {
      if (requestId === requestRef.current) setError(cause instanceof Error ? cause.message : 'Could not load API request logs.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedId && !dialog.open) dialog.showModal();
    else if (!selectedId && dialog.open) dialog.close();
  }, [selectedId]);

  async function openDetail(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError('');
    setShow403Help(false);
    setDetailLoading(true);
    try { setDetail(await loadJson<Log>(`/api/logs/${encodeURIComponent(id)}`)); }
    catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Could not load request details.'); }
    finally { setDetailLoading(false); }
  }

  async function copyBody(kind: 'request' | 'response', value: unknown) {
    try {
      await navigator.clipboard.writeText(bodyText(value));
      setCopied(kind);
      window.setTimeout(() => setCopied(''), 1500);
    } catch { setDetailError('Clipboard access is unavailable. Select and copy the JSON instead.'); }
  }

  const exportParams = new URLSearchParams({ format: 'csv' });
  if (search.trim()) exportParams.set('search', search.trim());
  if (status) exportParams.set('status', status);

  return <>
    <div className="pageHeading"><div><div className="eyebrow">API OBSERVABILITY</div><h1>Request logs</h1><p>Inspect authenticated API calls, response codes and sanitized JSON bodies. Email handoff and delivery status live in Emails.</p></div><button className="outlineButton" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}</div>}
    <section className="panel requestLogsPanel">
      <div className="tableToolbar requestLogsToolbar">
        <label className="searchBox"><span aria-hidden="true">⌕</span><span className="srOnly">Search logs</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search log ID or endpoint" /></label>
        <label className="emailStatusFilter"><span className="srOnly">Filter by response status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All responses</option><option value="errors">Errors</option><option value="success">Success</option>{[400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map((code) => <option value={String(code)} key={code}>{code}</option>)}</select></label>
        <span className="recordCount" aria-live="polite">{total.toLocaleString('en-AU')} logs</span>
        <a className="outlineButton requestLogsExport" href={`/api/logs?${exportParams.toString()}`}>Export CSV</a>
      </div>
      {loading && !logs.length ? <div className="emptyPanel">Loading request history…</div> : logs.length ? <div className="tableWrap requestLogsTableWrap"><table><thead><tr><th>TIME</th><th>METHOD</th><th>ENDPOINT</th><th>RESPONSE</th><th>USER AGENT</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}>
        <td data-label="Time" className="requestLogTime">{shortDate(log.created_at)}</td>
        <td data-label="Method"><span className="requestLogMethod">{log.method}</span></td>
        <td data-label="Endpoint"><button className="requestLogEndpoint" onClick={() => void openDetail(log.id)}><code>{log.endpoint}</code><small>{log.id}</small></button></td>
        <td data-label="Response"><span className={`plainStatus ${log.response_status >= 400 ? 'failed' : 'verified'}`}>{log.response_status}</span></td>
        <td data-label="User agent" className="requestLogAgent">{log.user_agent ?? 'Not provided'}</td>
      </tr>)}</tbody></table></div> : <div className="emptyPanel">{error ? 'Request logs are unavailable.' : search || status ? 'No logs match these filters.' : 'No authenticated API requests have been recorded yet.'}</div>}
      {nextAfter && <div className="emailLoadMore"><button className="outlineButton" onClick={() => void load({ append: true, after: nextAfter })} disabled={loading}>{loading ? 'Loading…' : 'Load older logs'}</button></div>}
    </section>
    <dialog ref={dialogRef} className="emailDetailDialog requestLogDialog" aria-labelledby="requestLogTitle" onClose={() => { requestRef.current += 1; setSelectedId(''); setDetail(null); setDetailLoading(false); }}>
      <div className="emailDetailHeader"><div><div className="eyebrow">API REQUEST DETAIL</div><h2 id="requestLogTitle">{detail ? `${detail.method} ${detail.endpoint}` : 'Request details'}</h2></div><button className="mobileMenuClose" onClick={() => setSelectedId('')} aria-label="Close request details">×</button></div>
      {detailLoading && <div className="emptyPanel">Loading request details…</div>}
      {detailError && <p className="inlineError requestLogError" role="alert">{detailError}</p>}
      {detail && <div className="emailDetailBody">
        <dl className="emailDetailMeta"><div><dt>Log ID / request ID</dt><dd><code>{detail.id}</code></dd></div><div><dt>Time</dt><dd>{shortDate(detail.created_at)}</dd></div><div><dt>Endpoint</dt><dd><code>{detail.endpoint}</code></dd></div><div><dt>Method</dt><dd>{detail.method}</dd></div><div><dt>Response</dt><dd><span className={detail.response_status >= 400 ? 'detailFailure' : ''}>{detail.response_status}</span></dd></div><div><dt>API key</dt><dd>{detail.api_key?.name ?? 'Unknown'}{detail.api_key?.prefix ? ` · ${detail.api_key.prefix}…` : ''}</dd></div><div><dt>Request size</dt><dd>{formatBytes(detail.request_bytes)}</dd></div><div><dt>Response size</dt><dd>{formatBytes(detail.response_bytes)}</dd></div><div><dt>User agent</dt><dd>{detail.user_agent ?? 'Not provided'}</dd></div></dl>
        {detail.response_status === 403 && <section className="requestLogHelp"><div><strong>Why was this request forbidden?</strong><p>Check the API key permission and verified sender domain. If the request includes a sender address, use its domain in Domains to review ownership and DNS setup.</p></div><button className="textButton" onClick={() => setShow403Help((value) => !value)} aria-expanded={show403Help}>{show403Help ? 'Hide guidance' : 'Help me fix'}</button>{show403Help && <p className="requestLogHelpDetail">{fromDomain(detail) ? `The request uses a sender at ${fromDomain(detail)}. Confirm that this domain is present and verified, then check the key's sending permission.` : 'No sender domain was available in this request body. Review the key permission and domain verification before retrying.'} An API request status does not confirm email delivery.</p>}</section>}
        <section className="emailDetailSection requestLogBody"><div><h3>Request body</h3><button className="textButton" onClick={() => void copyBody('request', detail.request_body)}>{copied === 'request' ? 'Copied' : 'Copy JSON'}</button></div><pre><code>{bodyText(detail.request_body)}</code></pre></section>
        <section className="emailDetailSection requestLogBody"><div><h3>Response body</h3><button className="textButton" onClick={() => void copyBody('response', detail.response_body)}>{copied === 'response' ? 'Copied' : 'Copy JSON'}</button></div><pre><code>{bodyText(detail.response_body)}</code></pre></section>
        <p className="requestLogPrivacyNote">Recipient addresses, message content and credential fields are redacted before storage. Only the sender domain is retained for troubleshooting. Large and non-JSON bodies are omitted or marked as truncated.</p>
      </div>}
    </dialog>
  </>;
}
