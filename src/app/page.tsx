'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BroadcastsWorkspace, ContactsWorkspace, SegmentsWorkspace, TemplatesWorkspace, TopicsWorkspace } from '@/components/email-workspaces';
import { WebhooksWorkspace } from '@/components/webhook-workspace';
import { ReceivingWorkspace } from '@/components/receiving-workspace';
import { AutomationWorkspace } from '@/components/automation-workspace';
import { SuppressionsWorkspace } from '@/components/suppression-workspace';
import { RequestLogsWorkspace } from '@/components/request-logs-workspace';

type Email = { id: string; from: string; to: string[]; subject: string; status: string; error_message: string | null; provider_id: string | null; scheduled_at: string | null; open_count: number; click_count: number; created_at: string };
type EmailDetail = { id: string; from: string; to: string[]; cc: string[]; bcc: string[]; reply_to: string | null; headers: Record<string, string>; tags: Array<{ name: string; value: string }>; attachments: Array<{ filename: string; contentType?: string; contentId?: string }>; subject: string; text: string | null; html: string | null; status: string; error: string | null; relay_response: string | null; message_id: string | null; scheduled_at: string | null; created_at: string };
type ApiKey = { id: string; name: string; prefix: string; permission: 'full_access' | 'sending_access'; domain_id: string | null; created_at: string; last_used_at: string | null };
type Domain = { id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null; open_tracking: boolean; click_tracking: boolean };
type DnsCheck = { checked_at: string; records: { spf: { status: string; host: string; values: string[] }; dmarc: { status: string; host: string; values: string[] }; mx: { status: string; values: Array<{ host: string; priority: number }> }; dkim: { status: string; message: string } } };
type Dashboard = { smtpConfigured: boolean; scheduledSendsEnabled: boolean; trackingConfigured: boolean; webhookSigningConfigured: boolean; preferencesConfigured: boolean; emails: Email[]; keys: ApiKey[]; domains: Domain[]; metrics: { total: number; sent: number; failed: number; opens: number; clicks: number } };
type View = 'Overview' | 'Emails' | 'Logs' | 'Suppressions' | 'Receiving' | 'Broadcasts' | 'Automations' | 'Domains' | 'API keys' | 'Templates' | 'Contacts' | 'Segments' | 'Topics' | 'Webhooks' | 'Quickstart' | 'Settings';
const navigation: View[] = ['Overview', 'Emails', 'Logs', 'Suppressions', 'Receiving', 'Broadcasts', 'Automations', 'Domains', 'API keys', 'Templates', 'Contacts', 'Segments', 'Topics', 'Webhooks', 'Quickstart', 'Settings'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${response.status})`);
  return data as T;
}
function formatDate(value: string) { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function shortStatus(status: string) { return status.charAt(0).toUpperCase() + status.slice(1); }
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: 'M3 3h8v8H3z M14 3h7v5h-7z M14 11h7v10h-7z M3 14h8v7H3z',
    emails: 'M3 5h18v14H3z M3 6l9 7 9-7',
    logs: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
    suppressions: 'M12 3 20 6v5c0 5.2-3.4 8.5-8 10-4.6-1.5-8-4.8-8-10V6z M8.5 12h7',
    receiving: 'M4 4h16v12H4z M8 20h8 M12 16v4 M7 9h10 M7 12h6',
    campaigns: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
    automations: 'M12 3v5 M12 16v5 M3 12h5 M16 12h5 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M5 5l3 3 M16 16l3 3 M19 5l-3 3 M8 16l-3 3',
    domains: 'M12 3v18 M3 12h18 M5.6 5.6l12.8 12.8 M18.4 5.6 5.6 18.4 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    keys: 'M7 14a5 5 0 1 1 3.9-1.9L21 22 M15 17l3 3 M18 14l3 3',
    templates: 'M4 5h16 M4 10h16 M4 15h9 M4 20h9 M17 16l4 4-4 4',
    contacts: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    segments: 'M4 5h16 M7 12h10 M10 19h4 M6 3v4 M18 10v4 M12 17v4',
    topics: 'M4 6h16 M4 12h10 M4 18h16 M18 10v4',
    webhooks: 'M8 12a4 4 0 0 1 4-4h4 M16 12a4 4 0 0 1-4 4H8 M7 8l-3 4 3 4 M17 8l3 4-3 4 M12 2v4 M12 18v4',
    docs: 'M6 3h9l5 5v13H6z M14 3v6h6 M9 13h8 M9 17h8',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.5l-.1.2h-3.4l-.1-.2a1.7 1.7 0 0 0-1.8-.5l-.2.1-1.7-2.9.1-.1a1.7 1.7 0 0 0 .3-1.9l-.1-.2-3.2-1.7v-3.4l.2-.1a1.7 1.7 0 0 0 .5-1.8l-.1-.2 2.9-1.7.1.1a1.7 1.7 0 0 0 1.9.3l.2-.1 1.7-3.2h3.4l.1.2a1.7 1.7 0 0 0 1.8.5l.2-.1 1.7 2.9-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.2 3.2 1.7v3.4l-.2.1a1.7 1.7 0 0 0-.5 1.8l.1.2-2.9 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3z',
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="icon"><path d={paths[name] ?? paths.overview} /></svg>;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [emailRows, setEmailRows] = useState<Email[]>([]);
  const [emailStatusFilter, setEmailStatusFilter] = useState('');
  const [emailTotal, setEmailTotal] = useState(0);
  const [emailAfter, setEmailAfter] = useState('');
  const [emailHasMore, setEmailHasMore] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailLoadError, setEmailLoadError] = useState('');
  const [emailDetailId, setEmailDetailId] = useState<string | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailDetail | null>(null);
  const [emailDetailLoading, setEmailDetailLoading] = useState(false);
  const [emailDetailError, setEmailDetailError] = useState('');
  const [view, setView] = useState<View>('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [keyName, setKeyName] = useState('Production');
  const [keyPermission, setKeyPermission] = useState<'full_access' | 'sending_access'>('full_access');
  const [keyDomainId, setKeyDomainId] = useState('');
  const [newKey, setNewKey] = useState('');
  const [domainName, setDomainName] = useState('');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [dnsChecks, setDnsChecks] = useState<Record<string, DnsCheck>>({});
  const mobileMenuRef = useRef<HTMLDialogElement>(null);
  const emailDetailRef = useRef<HTMLDialogElement>(null);
  const emailRequestRef = useRef(0);
  const emailDetailRequestRef = useRef(0);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await api<Dashboard & { authenticated: boolean }>('/api/dashboard');
      setDashboard(data);
      setAuthenticated(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load dashboard.';
      if (message.includes('EMAILGO_ADMIN_PASSWORD')) { setSetupRequired(true); setAuthenticated(false); }
      else if (message.includes('Sign in') || message.includes('401')) setAuthenticated(false);
      else setError(message);
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => {
    const dialog = mobileMenuRef.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    else if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);
  useEffect(() => {
    const dialog = emailDetailRef.current;
    if (!dialog) return;
    if (emailDetailId && !dialog.open) dialog.showModal();
    else if (!emailDetailId && dialog.open) dialog.close();
  }, [emailDetailId]);

  const loadEmails = useCallback(async ({ append = false, after = '' }: { append?: boolean; after?: string } = {}) => {
    const requestId = ++emailRequestRef.current;
    setEmailLoading(true);
    setEmailLoadError('');
    if (!append) setEmailRows([]);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (emailStatusFilter) params.set('status', emailStatusFilter);
      if (append && after) params.set('after', after);
      const result = await api<{ data: Array<Omit<Email, 'from'> & { from_address: string }>; total: number; has_more: boolean; next_after?: string }>(`/api/emails?${params}`);
      if (requestId !== emailRequestRef.current) return;
      const rows = result.data.map(({ from_address, ...email }) => ({ ...email, from: from_address }));
      setEmailRows((current) => append ? [...current, ...rows] : rows);
      setEmailTotal(result.total);
      setEmailHasMore(result.has_more);
      setEmailAfter(result.next_after ?? '');
    } catch (cause) {
      if (requestId === emailRequestRef.current) setEmailLoadError(cause instanceof Error ? cause.message : 'Could not load message history.');
    } finally {
      if (requestId === emailRequestRef.current) setEmailLoading(false);
    }
  }, [emailStatusFilter, search]);

  useEffect(() => {
    if (view !== 'Emails' || !authenticated) return;
    const timer = window.setTimeout(() => { void loadEmails(); }, 220);
    return () => window.clearTimeout(timer);
  }, [view, authenticated, loadEmails]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  async function openEmailDetail(id: string) {
    const requestId = ++emailDetailRequestRef.current;
    setEmailDetailId(id);
    setEmailDetail(null);
    setEmailDetailError('');
    setEmailDetailLoading(true);
    try {
      const result = await api<EmailDetail>(`/api/emails/${encodeURIComponent(id)}`);
      if (requestId === emailDetailRequestRef.current) setEmailDetail(result);
    } catch (cause) {
      if (requestId === emailDetailRequestRef.current) setEmailDetailError(cause instanceof Error ? cause.message : 'Could not load email details.');
    } finally {
      if (requestId === emailDetailRequestRef.current) setEmailDetailLoading(false);
    }
  }
  async function createKey(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api<{ secret: string }>('/api/keys', { method: 'POST', body: JSON.stringify({ name: keyName, permission: keyPermission, ...(keyPermission === 'sending_access' ? { domain_id: keyDomainId } : {}) }) }); setNewKey(result.secret); setKeyName(''); setKeyPermission('full_access'); setKeyDomainId(''); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create API key.'); }
    finally { setBusy(false); }
  }
  async function revokeKey(id: string) {
    if (!window.confirm('Revoke this API key? Applications using it will stop sending email.')) return;
    setBusy(true); setError('');
    try { await api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not revoke key.'); }
    finally { setBusy(false); }
  }
  async function addDomain(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/domains', { method: 'POST', body: JSON.stringify({ domain: domainName }) }); setDomainName(''); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add domain.'); }
    finally { setBusy(false); }
  }
  async function verifyDomain(id: string) {
    setBusy(true); setError('');
    try { await api(`/api/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' }); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Domain verification failed.'); }
    finally { setBusy(false); }
  }
  async function checkDomainDns(id: string) {
    setBusy(true); setError('');
    try { const result = await api<DnsCheck>(`/api/domains/${encodeURIComponent(id)}/dns`); setDnsChecks((current) => ({ ...current, [id]: result })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check DNS records.'); }
    finally { setBusy(false); }
  }
  async function updateDomainTracking(id: string, setting: 'open_tracking' | 'click_tracking', enabled: boolean) {
    setBusy(true); setError('');
    try { await api(`/api/domains/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ [setting]: enabled }) }); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update tracking settings.'); }
    finally { setBusy(false); }
  }
  async function logout() { setMenuOpen(false); await api('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); setDashboard(null); }
  async function copyKey() { await navigator.clipboard.writeText(newKey); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }

  if (authenticated === null && !setupRequired) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Emailgo</span><p>Loading your workspace…</p></main>;
  if (setupRequired) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Emailgo</span><section className="setupCard"><div className="eyebrow">FIRST RUN</div><h1>Set up your workspace</h1><p>Add the dashboard password and session secret to the server environment, then restart Emailgo.</p><pre><code>EMAILGO_ADMIN_PASSWORD=use-a-unique-long-password<br />EMAILGO_SESSION_SECRET=use-another-random-secret</code></pre><p className="muted">SMTP settings are added separately. Sending remains disabled until they are configured.</p></section></main>;
  if (!authenticated) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Emailgo</span><form className="loginCard" onSubmit={login}><div className="eyebrow">PRIVATE WORKSPACE</div><h1>Welcome back</h1><p>Sign in to manage your email API.</p><label>Admin password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="inlineError" role="alert">{error}</p>}<button className="primaryButton" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>;

  const metrics = dashboard?.metrics ?? { total: 0, sent: 0, failed: 0, opens: 0, clicks: 0 };
  return <div className="appShell">
    <a className="skipLink" href="#main">Skip to content</a>
    <aside className="sidebar"><a className="wordmark" href="#overview"><span className="mark">e</span><span>Emailgo<small>EMAIL DELIVERY</small></span></a><div className="workspaceLabel">WORKSPACE</div><nav aria-label="Workspace navigation">{navigation.map((item) => <button key={item} className={`navLink ${view === item ? 'active' : ''}`} onClick={() => setView(item)} aria-current={view === item ? 'page' : undefined}><Icon name={{Overview:'overview',Emails:'emails',Logs:'logs',Suppressions:'suppressions',Receiving:'receiving',Broadcasts:'campaigns',Automations:'automations',Domains:'domains','API keys':'keys',Templates:'templates',Contacts:'contacts',Segments:'segments',Topics:'topics',Webhooks:'webhooks',Quickstart:'docs',Settings:'settings'}[item]} />{item}</button>)}</nav><div className="sideFooter"><div className="workspaceAvatar">WT</div><div className="workspaceUser">Website Thanks<small>Owner workspace</small></div><button className="logoutButton" onClick={logout} aria-label="Sign out">↗</button></div></aside>
    <dialog ref={mobileMenuRef} className="mobileNavDialog" aria-labelledby="mobileMenuTitle" onClose={() => setMenuOpen(false)}>
      <div className="mobileNavHeader"><a className="wordmark" href="#overview"><span className="mark">e</span><span>Emailgo<small>EMAIL DELIVERY</small></span></a><button className="mobileMenuClose" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button></div>
      <div className="workspaceLabel" id="mobileMenuTitle">WORKSPACE</div>
      <nav aria-label="Mobile workspace navigation">{navigation.map((item) => <button key={item} className={`navLink ${view === item ? 'active' : ''}`} onClick={() => { setView(item); setMenuOpen(false); }} aria-current={view === item ? 'page' : undefined}><Icon name={{Overview:'overview',Emails:'emails',Logs:'logs',Suppressions:'suppressions',Receiving:'receiving',Broadcasts:'campaigns',Automations:'automations',Domains:'domains','API keys':'keys',Templates:'templates',Contacts:'contacts',Segments:'segments',Topics:'topics',Webhooks:'webhooks',Quickstart:'docs',Settings:'settings'}[item]} />{item}</button>)}</nav>
      <div className="mobileNavFooter"><div><strong>Website Thanks</strong><small>Owner workspace</small></div><button className="outlineButton" onClick={() => void logout()}>Sign out</button></div>
    </dialog>
    <main className="mainArea" id="main"><header className="topbar"><button className="mobileMenuButton" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="Open workspace menu"><span></span><span></span><span></span></button><div className="crumb">Workspace <span>/</span> <strong>{view}</strong></div><div className="topbarRight"><span className={`serviceState ${dashboard?.smtpConfigured ? 'ready' : ''}`}>{dashboard?.smtpConfigured ? 'SMTP configured' : 'SMTP setup needed'}</span><button className="userBadge" aria-label="Website Thanks account">WT</button></div></header>
      <div className="pageContent">
        {error && <div className="notice errorNotice" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
        {view === 'Overview' && <>
          <div className="pageHeading"><div><div className="eyebrow">EMAIL INFRASTRUCTURE</div><h1>Good morning.</h1><p>Your sending workspace, at a glance.</p></div><button className="outlineButton" onClick={() => void loadDashboard()}>Refresh activity</button></div>
          {!dashboard?.smtpConfigured && <div className="setupBanner"><div className="bannerIcon"><Icon name="settings" /></div><div><strong>Connect your delivery relay</strong><p>Add SMTP connection details to the server environment to enable email delivery. Messages will not send until it is configured.</p></div><button onClick={() => setView('Settings')}>View setup</button></div>}
          {dashboard && !dashboard.scheduledSendsEnabled && <div className="setupBanner"><div className="bannerIcon"><Icon name="settings" /></div><div><strong>Scheduled sending is disabled</strong><p>Set CRON_SECRET and enable the worker before accepting scheduled messages.</p></div><button onClick={() => setView('Settings')}>View setup</button></div>}
          {dashboard?.domains.length === 0 && <div className="setupBanner domainBanner"><div className="bannerIcon"><Icon name="domains" /></div><div><strong>Verify a sender domain</strong><p>Add a domain you own and publish its Emailgo TXT record before sending from it.</p></div><button onClick={() => setView('Domains')}>Add domain</button></div>}
          <section className="metricGrid" aria-label="Email activity summary"><article className="metricCard"><span>Messages, last 24 hours</span><strong>{metrics.total ?? 0}</strong><small>API requests recorded</small><div className="metricRule" /></article><article className="metricCard"><span>Accepted by relay</span><strong>{metrics.sent ?? 0}</strong><small>Email handoffs completed</small><div className="metricRule sage" /></article><article className="metricCard"><span>Opens tracked</span><strong>{metrics.opens ?? 0}</strong><small>Pixel loads recorded</small><div className="metricRule sage" /></article><article className="metricCard"><span>Link clicks</span><strong>{metrics.clicks ?? 0}</strong><small>Redirects recorded</small><div className="metricRule sage" /></article><article className="metricCard"><span>Delivery errors</span><strong>{metrics.failed ?? 0}</strong><small>SMTP rejected or unavailable</small><div className="metricRule rust" /></article></section>
          <section className="panel"><div className="panelHeader"><div><h2>Recent sends</h2><p>Your latest API email requests.</p></div><button className="textButton" onClick={() => setView('Emails')}>View all emails <span>→</span></button></div><EmailTable emails={dashboard?.emails.slice(0, 8) ?? []} onSelect={openEmailDetail} /></section>
          <section className="quickstartStrip"><div className="quickstartMark">01</div><div><span className="eyebrow">GET STARTED</span><strong>Make your first request</strong><p>Create an API key, verify a sender domain, then send through the Emailgo API.</p></div><button className="outlineButton" onClick={() => setView('Quickstart')}>Open quickstart</button></section>
        </>}
        {view === 'Emails' && <>
          <div className="pageHeading"><div><div className="eyebrow">MESSAGE LOG</div><h1>Emails</h1><p>Search and filter your recorded email activity.</p></div><button className="outlineButton" onClick={() => void loadEmails()} disabled={emailLoading}>{emailLoading ? 'Refreshing…' : 'Refresh'}</button></div>
          <div className="panel"><div className="tableToolbar emailToolbar"><label className="searchBox"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipient, sender or subject" /></label><label className="emailStatusFilter"><span className="srOnly">Filter by status</span><select value={emailStatusFilter} onChange={(event) => setEmailStatusFilter(event.target.value)}><option value="">All statuses</option>{['queued', 'scheduled', 'processing', 'sent', 'failed', 'suppressed', 'canceled'].map((status) => <option key={status} value={status}>{shortStatus(status)}</option>)}</select></label><span className="recordCount" aria-live="polite">{emailTotal} records</span></div>
            {emailLoadError && <p className="inlineError emailLoadError" role="alert">{emailLoadError}</p>}
            {emailLoading && !emailRows.length ? <div className="emptyPanel">Loading message history…</div> : emailRows.length ? <EmailTable emails={emailRows} onSelect={openEmailDetail} /> : <div className="emptyPanel">{emailLoadError ? 'Message history is unavailable.' : 'No email requests match these filters.'}</div>}
            {emailHasMore && <div className="emailLoadMore"><button className="outlineButton" disabled={emailLoading || !emailAfter} onClick={() => void loadEmails({ append: true, after: emailAfter })}>{emailLoading ? 'Loading…' : 'Load older messages'}</button></div>}
          </div>
        </>}
        {view === 'Suppressions' && <SuppressionsWorkspace />}
        {view === 'Logs' && <RequestLogsWorkspace />}
        {view === 'Receiving' && <ReceivingWorkspace />}
        {view === 'Broadcasts' && <BroadcastsWorkspace apiKeys={dashboard?.keys ?? []} domains={dashboard?.domains ?? []} canQueue={Boolean(dashboard?.smtpConfigured && dashboard?.scheduledSendsEnabled && dashboard?.preferencesConfigured)} />}
        {view === 'Automations' && <AutomationWorkspace apiKeys={dashboard?.keys ?? []} domains={dashboard?.domains ?? []} />}
        {view === 'Domains' && <>
          <div className="pageHeading"><div><div className="eyebrow">SENDER AUTHENTICATION</div><h1>Domains</h1><p>Verify sender domains before using them in API requests.</p></div></div>
          <form className="addForm panel" onSubmit={addDomain}><label>Domain name<input value={domainName} onChange={(event) => setDomainName(event.target.value)} placeholder="example.com" required /></label><button className="primaryButton" disabled={busy}>Add domain</button></form>
          <div className="domainList">{dashboard?.domains.length ? dashboard.domains.map((domain) => <article className="panel domainCard" key={domain.id}>
            <div className="domainCardTop"><div><h2>{domain.domain}</h2><p>Added {formatDate(domain.created_at)}</p></div><span className={`plainStatus ${domain.verified_at ? 'verified' : ''}`}>{domain.verified_at ? 'Verified' : 'Verification needed'}</span></div>
            {!domain.verified_at && <><p className="recordHint">Add this DNS TXT record at your domain provider. DNS can take a few minutes to update.</p><div className="dnsRecord"><span>Host</span><code>_emailgo.{domain.domain}</code><span>TXT value</span><code>{domain.verification_token}</code></div><button className="outlineButton verifyButton" onClick={() => void verifyDomain(domain.id)} disabled={busy}>Check DNS record</button></>}
            <section className="dnsDiagnostics"><div><div><h3>Authentication records</h3><p>Read-only SPF, DMARC and MX lookup. DKIM is provided by your SMTP relay.</p></div><button className="outlineButton" onClick={() => void checkDomainDns(domain.id)} disabled={busy}>{dnsChecks[domain.id] ? 'Check again' : 'Check DNS'}</button></div>{dnsChecks[domain.id] && <><div className="dnsChecks">{(['spf','dmarc','mx','dkim'] as const).map((name) => <span key={name} className={`plainStatus ${dnsChecks[domain.id].records[name].status === 'found' || dnsChecks[domain.id].records[name].status === 'relay_managed' ? 'verified' : ''}`}>{name.toUpperCase()}: {dnsChecks[domain.id].records[name].status.replaceAll('_',' ')}</span>)}</div><details className="dnsDetails"><summary>DNS lookup details, checked {formatDate(dnsChecks[domain.id].checked_at)}</summary><div><strong>SPF at {dnsChecks[domain.id].records.spf.host}</strong>{dnsChecks[domain.id].records.spf.values.length ? dnsChecks[domain.id].records.spf.values.map((value) => <code key={value}>{value}</code>) : <span>No SPF TXT record found.</span>}<strong>DMARC at {dnsChecks[domain.id].records.dmarc.host}</strong>{dnsChecks[domain.id].records.dmarc.values.length ? dnsChecks[domain.id].records.dmarc.values.map((value) => <code key={value}>{value}</code>) : <span>No DMARC TXT record found.</span>}<strong>MX records</strong>{dnsChecks[domain.id].records.mx.values.length ? dnsChecks[domain.id].records.mx.values.map((value) => <code key={`${value.priority}-${value.host}`}>{value.priority} {value.host}</code>) : <span>No MX record found.</span>}<strong>DKIM</strong><span>{dnsChecks[domain.id].records.dkim.message}</span></div></details></>}</section>
            <div className="domainTracking"><div><h3>Open and click tracking</h3><p>Disabled by default. Tracking records opens and link clicks for messages sent from this domain.</p></div>
              <label><input type="checkbox" checked={domain.open_tracking} onChange={(event) => void updateDomainTracking(domain.id, 'open_tracking', event.target.checked)} disabled={busy || !domain.verified_at || !dashboard.trackingConfigured} />Open tracking</label>
              <label><input type="checkbox" checked={domain.click_tracking} onChange={(event) => void updateDomainTracking(domain.id, 'click_tracking', event.target.checked)} disabled={busy || !domain.verified_at || !dashboard.trackingConfigured} />Click tracking</label>
              {domain.verified_at && !dashboard.trackingConfigured && <small>Configure EMAILGO_PUBLIC_URL and EMAILGO_TRACKING_SECRET to enable.</small>}
            </div>
          </article>) : <div className="emptyPanel">No sender domains yet. Add a domain you control to create its verification record.</div>}</div>
        </>}
        {view === 'API keys' && <><div className="pageHeading"><div><div className="eyebrow">AUTHENTICATION</div><h1>API keys</h1><p>Use secret keys to authenticate server side requests.</p></div></div><form className="addForm keyCreateForm panel" onSubmit={createKey}><label>Key name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Production app" required maxLength={80} /></label><label>Permission<select value={keyPermission} onChange={(event) => setKeyPermission(event.target.value as 'full_access' | 'sending_access')}><option value="full_access">Full access</option><option value="sending_access">Send email only</option></select></label>{keyPermission === 'sending_access' && <label>Verified sender domain<select value={keyDomainId} onChange={(event) => setKeyDomainId(event.target.value)} required><option value="">Choose a domain</option>{dashboard?.domains.filter((domain) => domain.verified_at).map((domain) => <option key={domain.id} value={domain.id}>{domain.domain}</option>)}</select></label>}<div className="keyPermissionHelp">{keyPermission === 'sending_access' ? <><strong>This key can send and schedule email</strong><span>It is restricted to one verified sender domain and can use batch sends. It cannot read message history, usage, contacts, segments, templates or webhook settings.</span>{!dashboard?.domains.some((domain) => domain.verified_at) && <span className="keyMissing">Verify a sender domain first. The key form stays disabled until one is available.</span>}</> : <><strong>This key has full access</strong><span>It can send email, read message history, tracking events and usage, and manage domains, templates, contacts, segments and webhooks.</span></>}</div><button className="primaryButton" disabled={busy || (keyPermission === 'sending_access' && !keyDomainId)}>Create API key</button></form>{newKey && <div className="newSecret"><div><strong>Copy your new API key now</strong><p>This secret is shown once. Emailgo stores only its hash.</p></div><code>{newKey}</code><button className="outlineButton" onClick={() => void copyKey()}>{copied ? 'Copied' : 'Copy key'}</button><span className="srOnly" role="status" aria-live="polite">{copied ? 'API key copied.' : ''}</span><button className="dismissButton" onClick={() => setNewKey('')} aria-label="Dismiss API key">×</button></div>}<div className="panel keyPanel"><div className="panelHeader"><div><h2>Active keys</h2><p>Revoked keys stop working immediately.</p></div></div>{dashboard?.keys.length ? dashboard.keys.map((key) => <div className="keyRow" key={key.id}><div className="keyGlyph"><Icon name="keys" /></div><div className="keyInfo"><strong>{key.name}</strong><code>{key.prefix}••••••••••••</code>{key.permission === 'sending_access' ? dashboard.domains.find((domain) => domain.id === key.domain_id) ? <small>Sending only · {dashboard.domains.find((domain) => domain.id === key.domain_id)?.domain}</small> : <small className="keyMissing">Sending only · domain unavailable. Revoke this key.</small> : <small>Full access</small>}</div><div className="keyLastUsed">{key.last_used_at ? `Used ${formatDate(key.last_used_at)}` : 'Not used yet'}</div><button className="dangerButton" onClick={() => void revokeKey(key.id)} disabled={busy}>Revoke</button></div>) : <div className="emptyPanel">No API keys yet. Create a key to authenticate your first request.</div>}</div></>}
        {view === 'Templates' && <TemplatesWorkspace />}
        {view === 'Contacts' && <ContactsWorkspace preferencesConfigured={dashboard?.preferencesConfigured ?? false} />}
        {view === 'Segments' && <SegmentsWorkspace />}
        {view === 'Topics' && <TopicsWorkspace />}
        {view === 'Webhooks' && <WebhooksWorkspace apiKeys={dashboard?.keys ?? []} signingConfigured={dashboard?.webhookSigningConfigured ?? false} />}
        {view === 'Quickstart' && <><div className="pageHeading"><div><div className="eyebrow">DEVELOPER GUIDE</div><h1>Quickstart</h1><p>Send your first email through the Emailgo API.</p></div></div><div className="guideSteps"><article className="guideStep"><span>01</span><div><h2>Verify a sender domain</h2><p>Add a domain you control in <button className="inlineLink" onClick={() => setView('Domains')}>Domains</button> and publish the TXT record. Configure SPF and DKIM records for your delivery relay to improve authentication and inbox placement.</p></div></article><article className="guideStep"><span>02</span><div><h2>Create an API key</h2><p>Generate a server side key in <button className="inlineLink" onClick={() => setView('API keys')}>API keys</button>. Store it in a secret manager and never expose it in browser code.</p></div></article><article className="guideStep"><span>03</span><div><h2>Send an email</h2><p>Make a request to your Emailgo instance. Replace the host and API key with your deployment values.</p><pre><code>{`curl -X POST http://localhost:3000/api/v1/emails \\\n  -H 'Authorization: Bearer eg_live_your_key' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello from Emailgo","text":"Your first email is on its way."}'`}</code></pre></div></article></div></>}
        {view === 'Settings' && <><div className="pageHeading"><div><div className="eyebrow">WORKSPACE CONFIGURATION</div><h1>Settings</h1><p>Runtime status and delivery connection.</p></div></div><section className="panel settingsPanel"><div className="panelHeader"><div><h2>SMTP delivery relay</h2><p>Emailgo provides the API and activity log. Configure an SMTP relay to deliver messages.</p></div><span className={`plainStatus ${dashboard?.smtpConfigured ? 'verified' : ''}`}>{dashboard?.smtpConfigured ? 'Configured' : 'Not configured'}</span></div><div className="envGrid">{[['EMAILGO_SMTP_HOST','SMTP server host'],['EMAILGO_SMTP_PORT','SMTP port, usually 587'],['EMAILGO_SMTP_USER','SMTP username'],['EMAILGO_SMTP_PASSWORD','SMTP password'],['EMAILGO_SMTP_SECURE','Set true for TLS on port 465']].map(([name, description]) => <div className="envRow" key={name}><code>{name}</code><span>{description}</span><strong>{name === 'EMAILGO_SMTP_PASSWORD' ? 'Secret' : 'Server setting'}</strong></div>)}</div><div className="securityNote">These values are read from the server environment only. Emailgo never returns SMTP credentials to the browser. For durable production use, run with persistent storage and back up the SQLite database file.</div></section><section className="panel settingsPanel"><div className="panelHeader"><div><h2>Scheduled sends</h2><p>Vercel Cron checks the durable message queue each minute on plans with minute-level cron cadence.</p></div><span className={`plainStatus ${dashboard?.scheduledSendsEnabled ? 'verified' : ''}`}>{dashboard?.scheduledSendsEnabled ? 'Configured' : 'Needs setup'}</span></div><div className="envGrid"><div className="envRow"><code>CRON_SECRET</code><span>Random server secret used to authenticate the scheduled worker.</span><strong>{dashboard?.scheduledSendsEnabled ? 'Configured' : 'Missing'}</strong></div><div className="envRow"><code>vercel.json</code><span>Registers /api/internal/worker every minute for production deployments.</span><strong>Repository config</strong></div></div><div className="securityNote">The deployment must have durable storage and a valid CRON_SECRET. Vercel plan limits determine the actual worker cadence; scheduled sends are rejected until the secret is configured.</div></section><section className="panel settingsPanel"><div className="panelHeader"><div><h2>Open and click tracking</h2><p>Tracking is off by default and configurable on each verified sender domain.</p></div><span className={`plainStatus ${dashboard?.trackingConfigured ? 'verified' : ''}`}>{dashboard?.trackingConfigured ? 'Configured' : 'Needs setup'}</span></div><div className="envGrid"><div className="envRow"><code>EMAILGO_PUBLIC_URL</code><span>Public HTTPS origin used for tracking image and redirect URLs.</span><strong>{dashboard?.trackingConfigured ? 'Configured' : 'Missing'}</strong></div><div className="envRow"><code>EMAILGO_TRACKING_SECRET</code><span>Independent random secret that signs tracking links.</span><strong>{dashboard?.trackingConfigured ? 'Configured' : 'Missing'}</strong></div></div><div className="securityNote">Emailgo stores event time and clicked URL domain and path. It does not collect recipient IP address, location or device details. Tracking settings remain disabled until both server values are present.</div></section><section className="panel settingsPanel"><div className="panelHeader"><div><h2>Admin access</h2><p>Set the initial workspace password and session signing secret in the server environment.</p></div></div><div className="envGrid">{[['EMAILGO_ADMIN_PASSWORD','Unique long password for workspace access'],['EMAILGO_SESSION_SECRET','Independent random secret used to sign sessions'],['Persistent storage','Mount ./data as a durable volume in production']].map(([name, description]) => <div className="envRow" key={name}><code>{name}</code><span>{description}</span><strong>Server setting</strong></div>)}</div></section><section className="panel settingsPanel"><div className="panelHeader"><div><h2>Contact preferences</h2><p>Public preference links let recipients manage topic choices and unsubscribe.</p></div><span className={`plainStatus ${dashboard?.preferencesConfigured ? 'verified' : ''}`}>{dashboard?.preferencesConfigured ? 'Configured' : 'Needs setup'}</span></div><div className="envGrid"><div className="envRow"><code>EMAILGO_PREFERENCES_SECRET</code><span>Independent random secret of at least 32 characters for signed preference links.</span><strong>{dashboard?.preferencesConfigured ? 'Configured' : 'Missing'}</strong></div></div><div className="securityNote">Preference links are long lived and stop working if the contact email or signing secret changes. Store the secret in the server environment and do not share links outside their intended recipient.</div></section></>}
      </div>
    </main>
    <dialog ref={emailDetailRef} className="emailDetailDialog" aria-labelledby="emailDetailTitle" onClose={() => { emailDetailRequestRef.current += 1; setEmailDetailId(null); setEmailDetail(null); setEmailDetailLoading(false); }}>
      <div className="emailDetailHeader"><div><div className="eyebrow">MESSAGE DETAIL</div><h2 id="emailDetailTitle">{emailDetail?.subject ?? 'Email details'}</h2></div><button className="mobileMenuClose" onClick={() => setEmailDetailId(null)} aria-label="Close email details">×</button></div>
      {emailDetailLoading && <div className="emptyPanel">Loading email details…</div>}
      {emailDetailError && <p className="inlineError" role="alert">{emailDetailError}</p>}
      {emailDetail && <div className="emailDetailBody">
        <dl className="emailDetailMeta"><div><dt>From</dt><dd>{emailDetail.from}</dd></div><div><dt>To</dt><dd>{emailDetail.to.join(', ')}</dd></div>{emailDetail.cc.length > 0 && <div><dt>Cc</dt><dd>{emailDetail.cc.join(', ')}</dd></div>}{emailDetail.bcc.length > 0 && <div><dt>Bcc</dt><dd>{emailDetail.bcc.join(', ')}</dd></div>}{emailDetail.reply_to && <div><dt>Reply to</dt><dd>{emailDetail.reply_to}</dd></div>}<div><dt>Status</dt><dd>{shortStatus(emailDetail.status)}{emailDetail.error && <span className="detailFailure"> · {emailDetail.error}</span>}</dd></div><div><dt>Created</dt><dd>{formatDate(emailDetail.created_at)}</dd></div>{emailDetail.message_id && <div><dt>Message ID</dt><dd><code>{emailDetail.message_id}</code></dd></div>}{emailDetail.relay_response && <div><dt>Relay response</dt><dd>{emailDetail.relay_response}</dd></div>}{emailDetail.tags.length > 0 && <div><dt>Tags</dt><dd>{emailDetail.tags.map((tag) => `${tag.name}=${tag.value}`).join(', ')}</dd></div>}{Object.keys(emailDetail.headers).length > 0 && <div><dt>Headers</dt><dd>{Object.entries(emailDetail.headers).map(([name, value]) => `${name}: ${value}`).join('\n')}</dd></div>}</dl>
        {emailDetail.text && <section className="emailDetailSection"><h3>Plain text</h3><pre>{emailDetail.text}</pre></section>}
        {emailDetail.html && <section className="emailDetailSection"><h3>HTML preview</h3><iframe title="Email HTML preview" sandbox="" srcDoc={htmlPreviewDocument(emailDetail.html)} /></section>}
        {emailDetail.attachments.length > 0 && <section className="emailDetailSection"><h3>Attachments</h3><ul>{emailDetail.attachments.map((attachment) => <li key={attachment.filename}>{attachment.filename}{attachment.contentType ? ` · ${attachment.contentType}` : ''}</li>)}</ul></section>}
      </div>}
    </dialog>
  </div>;
}

function htmlPreviewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"></head><body>${html}</body></html>`;
}

function EmailTable({ emails, onSelect }: { emails: Email[]; onSelect?: (id: string) => void }) {
  if (!emails.length) return <div className="emptyPanel">No messages yet. Email requests accepted by your API will appear here.</div>;
  return <div className="tableWrap"><table><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>STATUS</th><th>OPENS</th><th>CLICKS</th><th>TIME</th>{onSelect && <th><span className="srOnly">Details</span></th>}</tr></thead><tbody>{emails.map((email) => <tr key={email.id}><td data-label="Recipient"><span className="recipientEmail">{email.to.join(', ')}</span><small className="fromEmail">from {email.from}</small></td><td className="emailSubject" data-label="Subject">{email.subject}</td><td data-label="Status"><span className={`plainStatus ${email.status === 'sent' ? 'verified' : email.status === 'failed' ? 'failed' : email.status === 'suppressed' ? 'suppressedStatus' : ''}`}>{shortStatus(email.status)}</span>{email.error_message && <small className="failureReason">{email.error_message}</small>}</td><td data-label="Opens">{email.open_count ?? 0}</td><td data-label="Clicks">{email.click_count ?? 0}</td><td className="timeCell" data-label="Time">{formatDate(email.scheduled_at ?? email.created_at)}</td>{onSelect && <td data-label="Details"><button className="emailDetailsButton" onClick={() => onSelect(email.id)}>View</button></td>}</tr>)}</tbody></table></div>;
}
