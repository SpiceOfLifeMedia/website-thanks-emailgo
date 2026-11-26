'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import SendThanksDashboard, { type ApiKeyRow, type BlockRow, type DomainRow, type EmailRow, type View } from '@/components/SendThanksDashboard';
import { SendThanksLogo } from '@/components/SendThanksLogo';
import { BroadcastsWorkspace, ContactsWorkspace, SegmentsWorkspace, TemplatesWorkspace, TopicsWorkspace } from '@/components/email-workspaces';
import { WebhooksWorkspace } from '@/components/webhook-workspace';
import { ReceivingWorkspace } from '@/components/receiving-workspace';
import { AutomationWorkspace } from '@/components/automation-workspace';
import { SuppressionsWorkspace } from '@/components/suppression-workspace';
import { RequestLogsWorkspace } from '@/components/request-logs-workspace';
import { publicVerificationToken } from '@/lib/domain-verification';
import styles from './styles.module.css';

type EmailRecord = { id: string; from: string; to: string[]; subject: string; status: string; created_at: string };
type DashboardData = {
  authenticated: boolean;
  setupRequired?: boolean;
  smtpConfigured: boolean;
  scheduledSendsEnabled: boolean;
  preferencesConfigured: boolean;
  webhookSigningConfigured: boolean;
  emails: EmailRecord[];
  keys: Array<{ id: string; name: string; prefix: string; permission: 'full_access' | 'sending_access'; domain_id: string | null; created_at: string; last_used_at: string | null }>;
  domains: Array<{ id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null }>;
  blockedAddresses: Array<{ address: string; reason: string; added_at: string; removable?: boolean }>;
  metrics: { total: number; sent: number; bounced?: number; failed: number; monthToDate: number };
};

const viewByHash: Record<string, View> = {
  overview: 'overview', emails: 'emails', domains: 'domains', block: 'block', keys: 'keys', logs: 'logs', suppressions: 'suppressions', receiving: 'receiving',
  broadcasts: 'broadcasts', automations: 'automations', templates: 'templates', contacts: 'contacts', segments: 'segments', topics: 'topics', webhooks: 'webhooks', quickstart: 'quickstart', settings: 'settings',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as { error?: { message?: unknown } | string };
  if (!response.ok) {
    const error = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(typeof error === 'string' ? error : `Request failed (${response.status}).`);
  }
  return data as T;
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function emailStatus(status: string): EmailRow['status'] {
  const known: Record<string, EmailRow['status']> = {
    delivered: 'Delivered', bounced: 'Bounced', complained: 'Complained', deferred: 'Deferred', sent: 'Sent', queued: 'Queued', failed: 'Failed',
  };
  return known[status.toLowerCase()] ?? 'Queued';
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className={styles.auth}><div className={styles.authBrand}><SendThanksLogo withIcon size={25} /></div>{children}<p className={styles.authFoot}>A little less noise. A lot more thanks.</p></main>;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const readHash = () => setView(viewByHash[window.location.hash.slice(1)] ?? 'overview');
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await api<DashboardData>('/api/dashboard');
      setDashboard(data);
      setAuthenticated(true);
      setSetupRequired(false);
      setError('');
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('not configured for sign in')) {
        setSetupRequired(true);
        setAuthenticated(false);
      } else if (cause instanceof Error && (cause.message.includes('Sign in') || cause.message.includes('401'))) {
        setAuthenticated(false);
      } else {
        setError('We could not load your workspace. Please try again.');
      }
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      await loadDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally { setBusy(false); }
  }

  async function runAction<T>(action: () => Promise<T>): Promise<T> {
    setBusy(true);
    setError('');
    try { const result = await action(); await loadDashboard(); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'That action could not be completed.'); throw cause; }
    finally { setBusy(false); }
  }

  async function createApiKey(name: string) {
    const result = await runAction(() => api<{ secret: string }>('/api/keys', { method: 'POST', body: JSON.stringify({ name }) }));
    return result.secret;
  }

  async function signOut() {
    setBusy(true);
    try { await api('/api/auth/logout', { method: 'POST' }); setAuthenticated(false); setDashboard(null); }
    catch { setError('Could not sign out. Please try again.'); }
    finally { setBusy(false); }
  }

  if (authenticated === null && !setupRequired) return <AuthFrame><p className={styles.authLoading}>Getting your workspace ready…</p></AuthFrame>;
  if (setupRequired) return <AuthFrame><section className={styles.authCard}>
    <div className={styles.eyebrow}>FIRST RUN</div><h1>Set up your workspace</h1>
    <p>Add a password and session secret to the server environment, then restart the app.</p>
    <pre><code>EMAILGO_ADMIN_PASSWORD=use-a-unique-long-password<br />EMAILGO_SESSION_SECRET=use-another-random-secret</code></pre>
    <p className={styles.authMuted}>Add your SMTP connection details separately. Sending stays off until they are configured.</p>
  </section></AuthFrame>;
  if (!authenticated) return <AuthFrame><form className={styles.authCard} onSubmit={login}>
    <div className={styles.eyebrow}>PRIVATE WORKSPACE</div><h1>Welcome back</h1>
    <p>Sign in to manage your sending workspace.</p>
    <label className={styles.authLabel}>Admin password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    {error && <p className={styles.authError} role="alert">{error}</p>}
    <button className={styles.authSubmit} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></AuthFrame>;

  if (!dashboard) return <AuthFrame><p className={styles.authLoading} role="alert">{error || 'We could not load your workspace.'}</p><button className={styles.authSubmit} onClick={() => void loadDashboard()}>Try again</button></AuthFrame>;

  const emails: EmailRow[] = dashboard.emails.map((email) => ({
    id: email.id,
    to: email.to.join(', '),
    subject: email.subject,
    status: emailStatus(email.status),
    sentAt: formatDate(email.created_at),
  }));
  const apiKeys: ApiKeyRow[] = dashboard.keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: 'Secret hidden',
    permission: key.permission === 'full_access' ? 'Full access' : 'Send email',
    lastUsed: formatDate(key.last_used_at),
  }));
  const domains: DomainRow[] = dashboard.domains.map((domain) => {
    const token = publicVerificationToken(domain.verification_token);
    return {
      id: domain.id,
      name: domain.domain,
      status: domain.verified_at ? 'Verified' : 'Pending DNS',
      addedAt: formatDate(domain.created_at),
      records: domain.verified_at ? undefined : [{ type: 'TXT', name: `_send-thanks.${domain.domain}`, value: token, found: false }],
    };
  });
  const blockList: BlockRow[] = dashboard.blockedAddresses.map((entry) => ({
    address: entry.address,
    reason: entry.reason === 'bounced' ? 'Bounced' : entry.reason === 'complained' ? 'Complained' : 'Added manually',
    addedAt: formatDate(entry.added_at),
    removable: entry.removable,
  }));

  const pageContent = view === 'quickstart' ? <div className={styles.auxStack}>
    <article className={styles.auxCard}><span>01</span><div><h2>Verify a sender domain</h2><p>Add a domain you own and publish the TXT record shown in <a href="#domains" onClick={() => setView('domains')}>Domains</a>. Configure SPF and DKIM for your sending service too.</p></div></article>
    <article className={styles.auxCard}><span>02</span><div><h2>Create an API key</h2><p>Make a key in <a href="#keys" onClick={() => setView('keys')}>API keys</a>. Store it somewhere private and keep it out of browser code.</p></div></article>
    <article className={styles.auxCard}><span>03</span><div><h2>Send an email</h2><p>Use your own app host and secret key. A request accepted for handoff appears as <strong>Sent</strong>.</p><pre><code>{`curl -X POST http://localhost:3000/api/v1/emails \\\n  -H 'Authorization: Bearer st_live_your_key' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Send, thanks."}'`}</code></pre></div></article>
  </div> : view === 'settings' ? <div className={styles.auxStack}>
    <section className={styles.auxCard}><div><h2>SMTP delivery connection</h2><p>Send, thanks provides the API and activity log. Add an SMTP connection to deliver messages.</p><span className={`${styles.connectionState} ${dashboard.smtpConfigured ? styles.connected : ''}`}>{dashboard.smtpConfigured ? 'Configured' : 'Not configured'}</span></div></section>
    <section className={styles.auxCard}><div><h2>Server settings</h2><p>These values are read on the server only and are not shown in the browser.</p><ul><li><code>EMAILGO_SMTP_HOST</code> SMTP server host</li><li><code>EMAILGO_SMTP_PORT</code> SMTP port, usually 587</li><li><code>EMAILGO_SMTP_USER</code> SMTP username</li><li><code>EMAILGO_SMTP_PASSWORD</code> SMTP password</li><li><code>EMAILGO_SMTP_SECURE</code> Set true for TLS on port 465</li></ul></div></section>
    <section className={styles.auxCard}><div><h2>Delivery notifications</h2><p>Signed events update messages to Delivered, Bounced or Complained. Configure the HTTPS endpoint and a shared token on your event source.</p><ul><li><code>EMAILGO_WEBHOOK_TOKEN</code></li><li>Optional event source restrictions are set on the server.</li></ul><p><code>/api/webhooks/delivery-events?token=…</code></p></div></section>
    <section className={styles.auxCard}><div><h2>Admin access</h2><p>Set a unique workspace password and independent session signing secret.</p><ul><li><code>EMAILGO_ADMIN_PASSWORD</code></li><li><code>EMAILGO_SESSION_SECRET</code></li><li>Mount <code>./data</code> as durable storage when running outside a managed database.</li></ul></div></section>
  </div> : view === 'logs' ? <RequestLogsWorkspace />
    : view === 'suppressions' ? <SuppressionsWorkspace />
      : view === 'receiving' ? <ReceivingWorkspace />
        : view === 'broadcasts' ? <BroadcastsWorkspace apiKeys={dashboard.keys} domains={dashboard.domains} canQueue={dashboard.smtpConfigured && dashboard.scheduledSendsEnabled && dashboard.preferencesConfigured} />
          : view === 'automations' ? <AutomationWorkspace apiKeys={dashboard.keys} domains={dashboard.domains} />
            : view === 'templates' ? <TemplatesWorkspace />
              : view === 'contacts' ? <ContactsWorkspace preferencesConfigured={dashboard.preferencesConfigured} />
                : view === 'segments' ? <SegmentsWorkspace />
                  : view === 'topics' ? <TopicsWorkspace />
                    : view === 'webhooks' ? <WebhooksWorkspace apiKeys={dashboard.keys} signingConfigured={dashboard.webhookSigningConfigured} />
                      : undefined;

  return <>
    {error && <div className={styles.notice} role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss message">×</button></div>}
    <SendThanksDashboard
      view={view}
      accountName="Website Thanks"
      usage={{ sent: dashboard.metrics.monthToDate, limit: null, resetsOn: 'No reset configured' }}
      emails={emails}
      domains={domains}
      apiKeys={apiKeys}
      blockList={blockList}
      pageContent={pageContent}
      onNavigate={setView}
      onAddDomain={async (domain) => { await runAction(() => api('/api/domains', { method: 'POST', body: JSON.stringify({ domain }) })); }}
      onVerifyDomain={async (id) => { await runAction(() => api(`/api/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' })); }}
      onCreateApiKey={createApiKey}
      onRevokeApiKey={async (id) => { await runAction(() => api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })); }}
      onAddBlockedAddress={async (address) => { await runAction(() => api('/api/block-list', { method: 'POST', body: JSON.stringify({ address }) })); }}
      onRemoveBlockedAddress={async (address) => { await runAction(() => api(`/api/block-list/${encodeURIComponent(address)}`, { method: 'DELETE' })); }}
      onSignOut={signOut}
    />
  </>;
}
