'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Email = { id: string; from: string; to: string[]; subject: string; status: string; error_message: string | null; provider_id: string | null; created_at: string };
type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
type Domain = { id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null };
type Dashboard = { smtpConfigured: boolean; emails: Email[]; keys: ApiKey[]; domains: Domain[]; metrics: { total: number; sent: number; failed: number; bounced?: number } };
type View = 'Overview' | 'Emails' | 'Domains' | 'API keys' | 'Quickstart' | 'Settings';

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
    domains: 'M12 3v18 M3 12h18 M5.6 5.6l12.8 12.8 M18.4 5.6 5.6 18.4 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    keys: 'M7 14a5 5 0 1 1 3.9-1.9L21 22 M15 17l3 3 M18 14l3 3',
    docs: 'M6 3h9l5 5v13H6z M14 3v6h6 M9 13h8 M9 17h8',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.5l-.1.2h-3.4l-.1-.2a1.7 1.7 0 0 0-1.8-.5l-.2.1-1.7-2.9.1-.1a1.7 1.7 0 0 0 .3-1.9l-.1-.2-3.2-1.7v-3.4l.2-.1a1.7 1.7 0 0 0 .5-1.8l-.1-.2 2.9-1.7.1.1a1.7 1.7 0 0 0 1.9.3l.2-.1 1.7-3.2h3.4l.1.2a1.7 1.7 0 0 0 1.8.5l.2-.1 1.7 2.9-.1.1a1.7 1.7 0 0 0-.3 1.9l.1.2 3.2 1.7v3.4l-.2.1a1.7 1.7 0 0 0-.5 1.8l.1.2-2.9 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3z',
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="icon"><path d={paths[name] ?? paths.overview} /></svg>;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<View>('Overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [keyName, setKeyName] = useState('Production');
  const [newKey, setNewKey] = useState('');
  const [domainName, setDomainName] = useState('');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

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

  const filteredEmails = useMemo(() => dashboard?.emails.filter((email) => [email.to.join(' '), email.from, email.subject, email.status].join(' ').toLowerCase().includes(search.toLowerCase())) ?? [], [dashboard, search]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await loadDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  async function createKey(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api<{ secret: string }>('/api/keys', { method: 'POST', body: JSON.stringify({ name: keyName }) }); setNewKey(result.secret); setKeyName(''); await loadDashboard(); }
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
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); setDashboard(null); }
  async function copyKey() { await navigator.clipboard.writeText(newKey); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }

  if (authenticated === null && !setupRequired) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Email, thanks</span><p>Loading your workspace…</p></main>;
  if (setupRequired) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Email, thanks</span><section className="setupCard"><div className="eyebrow">FIRST RUN</div><h1>Set up your workspace</h1><p>Add the dashboard password and session secret to the server environment, then restart Email, thanks.</p><pre><code>EMAILGO_ADMIN_PASSWORD=use-a-unique-long-password<br />EMAILGO_SESSION_SECRET=use-another-random-secret</code></pre><p className="muted">SMTP settings are added separately. Sending remains disabled until they are configured.</p></section></main>;
  if (!authenticated) return <main className="screenState"><span className="wordmark"><span className="mark">e</span>Email, thanks</span><form className="loginCard" onSubmit={login}><div className="eyebrow">PRIVATE WORKSPACE</div><h1>Welcome back</h1><p>Sign in to manage your email API.</p><label>Admin password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="inlineError" role="alert">{error}</p>}<button className="primaryButton" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>;

  const metrics = dashboard?.metrics ?? { total: 0, sent: 0, failed: 0 };
  return <div className="appShell">
    <a className="skipLink" href="#main">Skip to content</a>
    <aside className="sidebar"><a className="wordmark" href="#overview"><span className="mark">e</span><span>Email, thanks<small>EMAIL DELIVERY</small></span></a><div className="workspaceLabel">WORKSPACE</div><nav aria-label="Workspace navigation">{(['Overview', 'Emails', 'Domains', 'API keys', 'Quickstart', 'Settings'] as View[]).map((item) => <button key={item} className={`navLink ${view === item ? 'active' : ''}`} onClick={() => setView(item)} aria-current={view === item ? 'page' : undefined}><Icon name={{Overview:'overview',Emails:'emails',Domains:'domains','API keys':'keys',Quickstart:'docs',Settings:'settings'}[item]} />{item}</button>)}</nav><div className="sideFooter"><div className="workspaceAvatar">WT</div><div className="workspaceUser">Website Thanks<small>Owner workspace</small></div><button className="logoutButton" onClick={logout} aria-label="Sign out">↗</button></div></aside>
    <main className="mainArea" id="main"><header className="topbar"><div className="crumb">Workspace <span>/</span> <strong>{view}</strong></div><div className="topbarRight"><span className={`serviceState ${dashboard?.smtpConfigured ? 'ready' : ''}`}>{dashboard?.smtpConfigured ? 'SMTP configured' : 'SMTP setup needed'}</span><button className="userBadge" aria-label="Website Thanks account">WT</button></div></header>
      <div className="pageContent">
        {error && <div className="notice errorNotice" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
        {view === 'Overview' && <>
          <div className="pageHeading"><div><div className="eyebrow">EMAIL INFRASTRUCTURE</div><h1>Good morning.</h1><p>Your sending workspace, at a glance.</p></div><button className="outlineButton" onClick={() => void loadDashboard()}>Refresh activity</button></div>
          {!dashboard?.smtpConfigured && <div className="setupBanner"><div className="bannerIcon"><Icon name="settings" /></div><div><strong>Connect your delivery relay</strong><p>Add SMTP connection details to the server environment to enable email delivery. Messages will not send until it is configured.</p></div><button onClick={() => setView('Settings')}>View setup</button></div>}
          {dashboard?.domains.length === 0 && <div className="setupBanner domainBanner"><div className="bannerIcon"><Icon name="domains" /></div><div><strong>Verify a sender domain</strong><p>Add a domain you own and publish its Email, thanks TXT record before sending from it.</p></div><button onClick={() => setView('Domains')}>Add domain</button></div>}
          <section className="metricGrid" aria-label="Email activity summary"><article className="metricCard"><span>Messages, last 24 hours</span><strong>{metrics.total ?? 0}</strong><small>API requests recorded</small><div className="metricRule" /></article><article className="metricCard"><span>Accepted by relay</span><strong>{metrics.sent ?? 0}</strong><small>Email handoffs completed</small><div className="metricRule sage" /></article><article className="metricCard"><span>Delivery errors</span><strong>{(metrics.failed ?? 0) + (metrics.bounced ?? 0)}</strong><small>Relay errors, bounces and spam reports</small><div className="metricRule rust" /></article></section>
          <section className="panel"><div className="panelHeader"><div><h2>Recent sends</h2><p>Your latest API email requests.</p></div><button className="textButton" onClick={() => setView('Emails')}>View all emails <span>→</span></button></div><EmailTable emails={dashboard?.emails.slice(0, 8) ?? []} /></section>
          <section className="quickstartStrip"><div className="quickstartMark">01</div><div><span className="eyebrow">GET STARTED</span><strong>Make your first request</strong><p>Create an API key, verify a sender domain, then send through the Email, thanks API.</p></div><button className="outlineButton" onClick={() => setView('Quickstart')}>Open quickstart</button></section>
        </>}
        {view === 'Emails' && <><div className="pageHeading"><div><div className="eyebrow">MESSAGE LOG</div><h1>Emails</h1><p>Requests accepted by your Email, thanks API.</p></div><button className="outlineButton" onClick={() => void loadDashboard()}>Refresh</button></div><div className="panel"><div className="tableToolbar"><label className="searchBox"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipient or subject" /></label><span className="recordCount">{filteredEmails.length} records</span></div><EmailTable emails={filteredEmails} /></div></>}
        {view === 'Domains' && <><div className="pageHeading"><div><div className="eyebrow">SENDER AUTHENTICATION</div><h1>Domains</h1><p>Verify sender domains before using them in API requests.</p></div></div><form className="addForm panel" onSubmit={addDomain}><label>Domain name<input value={domainName} onChange={(event) => setDomainName(event.target.value)} placeholder="example.com" required /></label><button className="primaryButton" disabled={busy}>Add domain</button></form><div className="domainList">{dashboard?.domains.length ? dashboard.domains.map((domain) => <article className="panel domainCard" key={domain.id}><div className="domainCardTop"><div><h2>{domain.domain}</h2><p>Added {formatDate(domain.created_at)}</p></div><span className={`plainStatus ${domain.verified_at ? 'verified' : ''}`}>{domain.verified_at ? 'Verified' : 'Verification needed'}</span></div>{!domain.verified_at && <><p className="recordHint">Add this DNS TXT record at your domain provider. DNS can take a few minutes to update.</p><div className="dnsRecord"><span>Host</span><code>_emailgo.{domain.domain}</code><span>TXT value</span><code>{domain.verification_token}</code></div><button className="outlineButton verifyButton" onClick={() => void verifyDomain(domain.id)} disabled={busy}>Check DNS record</button></>}</article>) : <div className="emptyPanel">No sender domains yet. Add a domain you control to create its verification record.</div>}</div></>}
        {view === 'API keys' && <><div className="pageHeading"><div><div className="eyebrow">AUTHENTICATION</div><h1>API keys</h1><p>Use secret keys to authenticate server side requests.</p></div></div><form className="addForm panel" onSubmit={createKey}><label>Key name<input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Production app" required maxLength={80} /></label><button className="primaryButton" disabled={busy}>Create API key</button></form>{newKey && <div className="newSecret"><div><strong>Copy your new API key now</strong><p>This secret is shown once. Email, thanks stores only its hash.</p></div><code>{newKey}</code><button className="outlineButton" onClick={() => void copyKey()}>{copied ? 'Copied' : 'Copy key'}</button><button className="dismissButton" onClick={() => setNewKey('')} aria-label="Dismiss API key">×</button></div>}<div className="panel keyPanel"><div className="panelHeader"><div><h2>Active keys</h2><p>Revoked keys stop working immediately.</p></div></div>{dashboard?.keys.length ? dashboard.keys.map((key) => <div className="keyRow" key={key.id}><div className="keyGlyph"><Icon name="keys" /></div><div className="keyInfo"><strong>{key.name}</strong><code>{key.prefix}••••••••••••</code></div><div className="keyLastUsed">{key.last_used_at ? `Used ${formatDate(key.last_used_at)}` : 'Not used yet'}</div><button className="dangerButton" onClick={() => void revokeKey(key.id)} disabled={busy}>Revoke</button></div>) : <div className="emptyPanel">No API keys yet. Create a key to authenticate your first request.</div>}</div></>}
        {view === 'Quickstart' && <><div className="pageHeading"><div><div className="eyebrow">DEVELOPER GUIDE</div><h1>Quickstart</h1><p>Send your first email through the Email, thanks API.</p></div></div><div className="guideSteps"><article className="guideStep"><span>01</span><div><h2>Verify a sender domain</h2><p>Add a domain you control in <button className="inlineLink" onClick={() => setView('Domains')}>Domains</button> and publish the TXT record. Configure SPF and DKIM records for your delivery relay to improve authentication and inbox placement.</p></div></article><article className="guideStep"><span>02</span><div><h2>Create an API key</h2><p>Generate a server side key in <button className="inlineLink" onClick={() => setView('API keys')}>API keys</button>. Store it in a secret manager and never expose it in browser code.</p></div></article><article className="guideStep"><span>03</span><div><h2>Send an email</h2><p>Make a request to your Email, thanks instance. Replace the host and API key with your deployment values.</p><pre><code>{`curl -X POST http://localhost:3000/api/v1/emails \\\n  -H 'Authorization: Bearer eg_live_your_key' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello from Email, thanks","text":"Your first email is on its way."}'`}</code></pre></div></article></div></>}
        {view === 'Settings' && <><div className="pageHeading"><div><div className="eyebrow">WORKSPACE CONFIGURATION</div><h1>Settings</h1><p>Runtime status and delivery connection.</p></div></div><section className="panel settingsPanel"><div className="panelHeader"><div><h2>SMTP delivery relay</h2><p>Email, thanks provides the API and activity log. Configure an SMTP relay to deliver messages.</p></div><span className={`plainStatus ${dashboard?.smtpConfigured ? 'verified' : ''}`}>{dashboard?.smtpConfigured ? 'Configured' : 'Not configured'}</span></div><div className="envGrid">{[['EMAILGO_SMTP_HOST','SMTP server host'],['EMAILGO_SMTP_PORT','SMTP port, usually 587'],['EMAILGO_SMTP_USER','SMTP username'],['EMAILGO_SMTP_PASSWORD','SMTP password'],['EMAILGO_SMTP_SECURE','Set true for TLS on port 465'],['EMAILGO_WEBHOOK_TOKEN','Random token for the delivery events URL'],['EMAILGO_SNS_TOPIC_ARNS','Comma separated SNS topics allowed to post events']].map(([name, description]) => <div className="envRow" key={name}><code>{name}</code><span>{description}</span><strong>{['EMAILGO_SMTP_PASSWORD', 'EMAILGO_WEBHOOK_TOKEN'].includes(name) ? 'Secret' : 'Server setting'}</strong></div>)}</div><div className="securityNote">These values are read from the server environment only. Email, thanks never returns SMTP credentials to the browser. For durable production use, run with persistent storage and back up the SQLite database file.</div></section><section className="panel settingsPanel"><div className="panelHeader"><div><h2>Admin access</h2><p>Set the initial workspace password and session signing secret in the server environment.</p></div></div><div className="envGrid">{[['EMAILGO_ADMIN_PASSWORD','Unique long password for workspace access'],['EMAILGO_SESSION_SECRET','Independent random secret used to sign sessions'],['Persistent storage','Mount ./data as a durable volume in production']].map(([name, description]) => <div className="envRow" key={name}><code>{name}</code><span>{description}</span><strong>Server setting</strong></div>)}</div></section></>}
      </div>
    </main>
  </div>;
}

function EmailTable({ emails }: { emails: Email[] }) {
  if (!emails.length) return <div className="emptyPanel">No messages yet. Email requests accepted by your API will appear here.</div>;
  return <div className="tableWrap"><table><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>STATUS</th><th>TIME</th></tr></thead><tbody>{emails.map((email) => <tr key={email.id}><td><span className="recipientEmail">{email.to.join(', ')}</span><small className="fromEmail">from {email.from}</small></td><td className="emailSubject">{email.subject}</td><td><span className={`plainStatus ${['sent', 'delivered'].includes(email.status) ? 'verified' : ['failed', 'bounced', 'complained'].includes(email.status) ? 'failed' : ''}`}>{shortStatus(email.status)}</span>{email.error_message && <small className="failureReason">{email.error_message}</small>}</td><td className="timeCell">{formatDate(email.created_at)}</td></tr>)}</tbody></table></div>;
}
