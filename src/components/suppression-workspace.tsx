'use client';

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsv } from '@/lib/csv';

type Suppression = { id: string; email: string; contact_id?: string; origin: 'manual' | 'bounce' | 'complaint'; source_id: string | null; created_at: string };
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${response.status})`);
  return data as T;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function SuppressionsWorkspace() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState('');
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [nextAfter, setNextAfter] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);

  const load = useCallback(async (after?: string) => {
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (after) query.set('after', after);
      const result = await api<{ data: Suppression[]; has_more: boolean; next_after?: string }>(`/api/suppressions?${query}`);
      setRows((current) => after ? [...current, ...result.data] : result.data);
      setHasMore(result.has_more);
      setNextAfter(result.next_after ?? '');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the suppression list.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((row) =>
    (!origin || row.origin === origin) && row.email.toLowerCase().includes(search.trim().toLowerCase()),
  ), [origin, rows, search]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));

  async function addOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<Suppression>('/api/suppressions', { method: 'POST', body: JSON.stringify({ email }) });
      setEmail('');
      await load();
      setNotice(`${result.email} is now suppressed from sending.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add the address.'); }
    finally { setBusy(false); }
  }

  async function removeOne(row: Suppression) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/suppressions/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      setSelected((current) => current.filter((id) => id !== row.id));
      await load();
      setNotice(`${row.email} was removed from the suppression list.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the address.'); }
    finally { setBusy(false); }
  }

  async function removeSelected() {
    const emails = rows.filter((row) => selected.includes(row.id)).map((row) => row.email);
    if (!emails.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      for (let index = 0; index < emails.length; index += 100) {
        await api('/api/suppressions/batch', { method: 'DELETE', body: JSON.stringify({ emails: emails.slice(index, index + 100) }) });
      }
      setSelected([]); await load(); setNotice(`${emails.length} address${emails.length === 1 ? '' : 'es'} removed from the suppression list.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the selected addresses.'); }
    finally { setBusy(false); }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImportFile(file); setError(''); setNotice('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2_000_000) {
      setError('Choose a CSV file smaller than 2 MB.'); return;
    }
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text(), 2_000);
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.rows.length < 2) throw new Error('The CSV needs an email header and at least one address.');
      const headers = parsed.rows[0].map((value) => value.trim().toLowerCase().replace(/\s+/g, '_'));
      const emailIndex = headers.findIndex((header) => header === 'email' || header === 'email_address');
      if (emailIndex < 0) throw new Error('Add an email or email_address column to the CSV.');
      const emails = [...new Set(parsed.rows.slice(1).map((row) => (row[emailIndex] ?? '').trim().toLowerCase()).filter(Boolean))];
      const invalid = emails.filter((value) => value.length > 254 || !emailPattern.test(value));
      if (invalid.length) throw new Error(`${invalid.length} address${invalid.length === 1 ? '' : 'es'} are invalid. Correct the CSV and import it again.`);
      for (let index = 0; index < emails.length; index += 100) {
        await api('/api/suppressions/batch', { method: 'POST', body: JSON.stringify({ emails: emails.slice(index, index + 100) }) });
      }
      setImportFile(null);
      event.target.value = '';
      await load();
      setNotice(`${emails.length} suppression${emails.length === 1 ? '' : 's'} imported. Existing entries were left unchanged.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import the CSV.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="pageHeading suppressionHeading"><div><div className="eyebrow">SENDING SAFETY</div><h1>Suppressions</h1><p>Prevent an address from receiving email across every sender domain in this workspace.</p></div><div className="suppressionHeadingActions"><a className="outlineButton" href="/api/suppressions?format=csv">Export CSV</a><button className="outlineButton" onClick={() => void load()}>Refresh</button></div></div>
    <div className="suppressionNotice"><strong>Removing an address allows future sends to be attempted.</strong><span>Removal does not guarantee delivery. Addresses may be suppressed again if your relay reports a bounce or complaint. Only manual suppression entries are available until a delivery-event provider is connected.</span></div>
    {error && <div className="notice errorNotice" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
    {notice && <div className="notice successNotice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    <div className="suppressionActionsGrid">
      <form className="panel suppressionAddForm" onSubmit={(event) => void addOne(event)}>
        <div className="panelHeader"><div><h2>Add an address</h2><p>New sends to this address are skipped before the SMTP relay.</p></div></div>
        <div className="suppressionAddFields"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="person@example.com" required /></label><button className="primaryButton" disabled={busy}>{busy ? 'Saving…' : 'Suppress address'}</button></div>
      </form>
      <section className="panel suppressionImport">
        <div className="panelHeader"><div><h2>Import a CSV</h2><p>Include an <code>email</code> or <code>email_address</code> column. Up to 2,000 rows per file.</p></div></div>
        <label className="suppressionFileInput">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event)} disabled={busy} /></label>
        <span className="suppressionFileName" aria-live="polite">{importFile?.name ?? 'CSV uploads are processed in batches of 100.'}</span>
      </section>
    </div>
    <section className="panel suppressionList">
      <div className="suppressionToolbar"><label className="searchBox"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppressed addresses" /></label><label className="suppressionOriginFilter"><span className="srOnly">Filter by origin</span><select value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="">All origins</option><option value="manual">Manual</option><option value="bounce">Bounce</option><option value="complaint">Complaint</option></select></label><span className="recordCount">{filtered.length}{hasMore ? '+' : ''} addresses</span><button className="textButton suppressionSelectVisible" onClick={() => setSelected((current) => allVisibleSelected ? current.filter((id) => !filtered.some((row) => row.id === id)) : [...new Set([...current, ...filtered.map((row) => row.id)])])}>{allVisibleSelected ? 'Clear visible' : 'Select visible'}</button></div>
      {selected.length > 0 && <div className="suppressionBulkBar"><span>{selected.length} selected</span><button className="dangerButton" onClick={() => void removeSelected()} disabled={busy}>Remove selected</button></div>}
      {filtered.length ? <div className="suppressionRows">{filtered.map((row) => <article className="suppressionRow" key={row.id}>
        <label className="suppressionSelect"><input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /><span className="srOnly">Select {row.email}</span></label>
        <div className="suppressionAddress"><strong>{row.email}</strong>{row.contact_id && <span>Contact record on file</span>}</div>
        <span className={`suppressionOrigin ${row.origin}`}>{row.origin}</span>
        <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
        <button className="textButton" onClick={() => void removeOne(row)} disabled={busy}>Remove</button>
      </article>)}</div> : <div className="emptyPanel">{rows.length ? 'No suppressions match your filters.' : 'No addresses are suppressed yet. Add an address or import a CSV to keep it out of future sends.'}</div>}
      {hasMore && nextAfter && <div className="suppressionLoadMore"><button className="outlineButton" onClick={() => void load(nextAfter)} disabled={busy}>Load more addresses</button></div>}
    </section>
  </>;
}
