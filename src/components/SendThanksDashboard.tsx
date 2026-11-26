'use client';
/**
 * Send, thanks: dashboard shell + Overview (selected direction 2b "Workbench").
 * Presentational only: pass data from your existing loaders and wire actions to your
 * EXISTING handlers. Any action prop left undefined is not rendered. This adds no new
 * backend operations.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommaIcon, SendThanksLogo } from './SendThanksLogo';
import s from './send-thanks-dashboard.module.css';

export type View = 'overview' | 'emails' | 'domains' | 'block' | 'keys' | 'logs' | 'suppressions' | 'receiving' | 'broadcasts' | 'automations' | 'templates' | 'contacts' | 'segments' | 'topics' | 'webhooks' | 'quickstart' | 'settings' | 'detail';
export type EmailStatus = 'Delivered' | 'Bounced' | 'Complained' | 'Deferred' | 'Sent' | 'Queued' | 'Failed';
export type DomainStatus = 'Verified' | 'Pending DNS';
export type BlockReason = 'Bounced' | 'Complained' | 'Added manually';

export interface EmailRow { id: string; to: string; subject: string; status: EmailStatus; sentAt: string }
export interface DnsRecord { type: string; name: string; value: string; found: boolean }
export interface DomainRow { id: string; name: string; status: DomainStatus; addedAt: string; records?: DnsRecord[] }
export interface ApiKeyRow { id: string; name: string; prefix: string; permission: string; lastUsed: string; revoked?: boolean }
export interface BlockRow { address: string; reason: BlockReason; addedAt: string; removable?: boolean }
export interface Usage { sent: number; limit: number | null; resetsOn: string }

export interface DashboardProps {
  view: View;
  accountName: string;
  usage: Usage;
  emails: EmailRow[];
  domains: DomainRow[];
  apiKeys: ApiKeyRow[];
  blockList: BlockRow[];
  hrefs?: Partial<Record<View, string>>;
  isDemo?: boolean;
  pageContent?: ReactNode;
  onNavigate?: (view: View) => void;
  onAddDomain?: (domain: string) => void | Promise<void>;
  onVerifyDomain?: (id: string) => void | Promise<void>;
  onCreateApiKey?: (name: string) => string | void | Promise<string | void>;
  onRevokeApiKey?: (id: string) => void | Promise<void>;
  onAddBlockedAddress?: (address: string) => void | Promise<void>;
  onRemoveBlockedAddress?: (address: string) => void | Promise<void>;
  onSignOut?: () => void | Promise<void>;
}

const DEFAULT_HREFS: Record<View, string> = {
  overview: '#overview', emails: '#emails', domains: '#domains', block: '#block', keys: '#keys', logs: '#logs', suppressions: '#suppressions', receiving: '#receiving', detail: '#emails',
  broadcasts: '#broadcasts', automations: '#automations', templates: '#templates', contacts: '#contacts', segments: '#segments', topics: '#topics', webhooks: '#webhooks', quickstart: '#quickstart', settings: '#settings',
};

const P: Record<string, string> = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  emails: 'M3 6h18v12H3zM3 7l9 6 9-6',
  domains: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  block: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  keys: 'M15 3a6 6 0 1 1-5.2 9L3 18.8V21h3v-2h2v-2h2l1.8-1.8A6 6 0 0 1 15 3zM16.5 7.5h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bounce: 'M10 6l-5 5 5 5M5 11h9a5 5 0 0 1 0 10h-3',
  flag: 'M6 21V4h11l-2.5 4.5L17 13H6',
  clock: 'M12 7v5l3.5 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  x: 'M7 7l10 10M17 7L7 17',
  plus: 'M12 5v14M5 12h14',
  logs: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  suppressions: 'M12 3 20 6v5c0 5.2-3.4 8.5-8 10-4.6-1.5-8-4.8-8-10V6zM8.5 12h7',
  receiving: 'M4 4h16v12H4zM8 20h8M12 16v4M7 9h10',
  broadcasts: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  automations: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  templates: 'M4 5h16M4 10h16M4 15h9M4 20h9',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  segments: 'M4 5h16M7 12h10M10 19h4',
  topics: 'M4 6h16M4 12h10M4 18h16',
  webhooks: 'M8 12a4 4 0 0 1 4-4h4M16 12a4 4 0 0 1-4 4H8M7 8l-3 4 3 4M17 8l3 4-3 4',
};

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'emails', label: 'Emails' }, { id: 'domains', label: 'Domains' },
  { id: 'block', label: 'Block list' }, { id: 'keys', label: 'API keys' },
];

const MORE_NAV: { id: View; label: string }[] = [
  { id: 'logs', label: 'Request logs' }, { id: 'suppressions', label: 'Suppressions' }, { id: 'receiving', label: 'Receiving' },
  { id: 'broadcasts', label: 'Broadcasts' }, { id: 'automations', label: 'Automations' }, { id: 'templates', label: 'Templates' },
  { id: 'contacts', label: 'Contacts' }, { id: 'segments', label: 'Segments' }, { id: 'topics', label: 'Topics' }, { id: 'webhooks', label: 'Webhooks' },
];

const COPY: Record<View, [string, string]> = {
  overview: ['Overview', 'How your sending is going, at a glance.'],
  emails: ['Emails', 'Every email sent from your account, newest first.'],
  domains: ['Domains', 'The domains you send from. Each one needs a few DNS records before it can send.'],
  block: ['Block list', 'Addresses added here, permanent bounces and complaints are blocked from future sends.'],
  keys: ['API keys', 'Keys let your website and apps send email. Treat them like a password.'],
  logs: ['Request logs', 'See API requests, responses and delivery attempts.'],
  suppressions: ['Suppressions', 'Review and manage addresses that should not receive email.'],
  receiving: ['Receiving', 'Inspect inbound messages delivered to your workspace.'],
  broadcasts: ['Broadcasts', 'Prepare and schedule email for opted-in contacts.'],
  automations: ['Automations', 'Build event-driven messages and review each run.'],
  templates: ['Templates', 'Create reusable message templates and manage versions.'],
  contacts: ['Contacts', 'Manage contact details, consent and preferences.'],
  segments: ['Segments', 'Group contacts using saved filters.'],
  topics: ['Topics', 'Manage subscription topics and contact preferences.'],
  webhooks: ['Webhooks', 'Send signed event updates to your application.'],
  quickstart: ['Quickstart', 'Create a key, verify a sender domain, then make your first request.'],
  settings: ['Settings', 'Workspace access and delivery connection.'],
  detail: ['', ''],
};

const BADGE: Record<string, { cls: string; icon: string }> = {
  Delivered: { cls: 'b-delivered', icon: P.check }, Verified: { cls: 'b-verified', icon: P.check },
  Bounced: { cls: 'b-bounced', icon: P.bounce }, Complained: { cls: 'b-complained', icon: P.flag },
  'Pending DNS': { cls: '', icon: P.clock }, 'Added manually': { cls: '', icon: P.block }, Revoked: { cls: 'b-revoked', icon: P.x },
  Deferred: { cls: '', icon: P.clock }, Sent: { cls: '', icon: P.check }, Queued: { cls: '', icon: P.clock }, Failed: { cls: 'b-failed', icon: P.x },
};

const fmt = (n: number) => n.toLocaleString('en-AU');
const shortEmailId = (id: string) => id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;

function Icon({ d, size = 20, width = 2 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function StatusBadge({ label }: { label: string }) {
  const b = BADGE[label] ?? { cls: '', icon: P.check };
  return (
    <span className={`${s.badge} ${b.cls ? s[b.cls] : ''}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={b.icon} /></svg>
      {label}
    </span>
  );
}

function Meter({ usage, large }: { usage: Usage; large?: boolean }) {
  if (usage.limit === null) return null;
  const pct = usage.limit > 0 ? Math.min(100, (usage.sent / usage.limit) * 100) : 0;
  return (
    <div role="meter" aria-label="Emails sent this month" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.sent}
      className={`${s.meter} ${large ? s.meterLg : ''}`}>
      <div className={s.meterFill} style={{ width: `${pct.toFixed(1)}%` }} />
    </div>
  );
}

function Card({ title, meta, action, className, children }: { title: string; meta?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`${s.card} ${className ?? ''}`}>
      <div className={s.cardHead}>
        <div className={s.cardTitle}><h2 className={s.h2}>{title}</h2>{meta && <span className={s.mono}>{meta}</span>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function SendThanksDashboard(props: DashboardProps) {
  const { view, usage, accountName, isDemo } = props;
  const hrefs = { ...DEFAULT_HREFS, ...props.hrefs };
  const ov = view === 'overview';
  const [filter, setFilter] = useState<'All' | EmailStatus>('All');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.domains.filter(d => d.status === 'Pending DNS').map(d => [d.name, true])));
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState<'domain' | 'key' | 'block' | null>(null);
  const [draft, setDraft] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 759px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const emails = useMemo(() => {
    const list = ov || filter === 'All' ? props.emails : props.emails.filter(e => e.status === filter);
    return ov ? list.slice(0, mobile ? 3 : 6) : list;
  }, [props.emails, filter, mobile, ov]);
  const blocked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !ov && q ? props.blockList.filter(b => b.address.toLowerCase().includes(q)) : props.blockList;
    return ov ? list.slice(0, 3) : list;
  }, [props.blockList, query, ov]);

  const action = view === 'domains' && props.onAddDomain ? { label: 'Add a domain', kind: 'domain' as const }
    : view === 'block' && props.onAddBlockedAddress ? { label: 'Add an address', kind: 'block' as const }
    : view === 'keys' && props.onCreateApiKey ? { label: 'Create an API key', kind: 'key' as const } : null;

  const show = { usage: ov, emails: ov || view === 'emails', domains: ov || view === 'domains', keys: ov || view === 'keys', block: ov || view === 'block' };
  const pct = usage.limit !== null && usage.limit > 0 ? Math.min(100, Math.round((usage.sent / usage.limit) * 100)) : null;
  const seeAll = (v: View, label: string, mobileLabel?: string) => ov ? <Link href={hrefs[v]} className={s.secondary} onClick={() => props.onNavigate?.(v)}><span className={s.desktopOnly}>{label}</span><span className={s.mobileOnly}>{mobileLabel ?? label}</span></Link> : null;
  const verified = props.domains.filter(d => d.status === 'Verified').length;
  const statusOrder: EmailStatus[] = ['Delivered', 'Bounced', 'Complained', 'Sent', 'Queued', 'Failed'];
  const availableStatuses = statusOrder.filter(status => props.emails.some(email => email.status === status));

  const navLinks = (cls: string, iconSize: number, withCount: boolean) => NAV.map(n => (
    <Link key={n.id} href={hrefs[n.id]} className={cls} onClick={() => props.onNavigate?.(n.id)} aria-current={n.id === view || (view === 'detail' && n.id === 'emails') ? 'page' : undefined}>
      <Icon d={P[n.id]} size={iconSize} />
      {withCount ? <span className={s.navLabel}>{n.label}</span> : n.label}
      {withCount && n.id === 'block' && <span className={s.navCount}>{props.blockList.length}</span>}
    </Link>
  ));

  return (
    <div className={s.root}>
      <aside className={s.sidebar}>
        <div className={s.brand}><SendThanksLogo size={21} withIcon iconSize={32} /></div>
        <div className={s.account}>
          <span className={s.mono}>ACCOUNT</span>
          <span className={s.accountName}>{accountName}</span>
          {isDemo && <span className={s.mono}>FICTIONAL DEMO ACCOUNT</span>}
        </div>
        <nav aria-label="Dashboard" className={s.nav}>{navLinks(s.navItem, 20, true)}</nav>
        <details className={s.sideMore}>
          <summary>More tools</summary>
          <nav aria-label="More workspace tools">
            {MORE_NAV.map(item => <Link key={item.id} href={hrefs[item.id]} aria-current={item.id === view ? 'page' : undefined} onClick={() => props.onNavigate?.(item.id)}>{item.label}</Link>)}
          </nav>
        </details>
        <div className={s.sideUsage}>
          <strong>{fmt(usage.sent)} requests this month</strong>
          <Meter usage={usage} />
          {usage.limit !== null && <span><strong>{fmt(Math.max(0, usage.limit - usage.sent))}</strong> remaining</span>}
        </div>
        <div className={s.sideLinks}>
          <Link href={hrefs.quickstart} onClick={() => props.onNavigate?.('quickstart')} aria-current={view === 'quickstart' ? 'page' : undefined}>Quickstart</Link>
          <Link href={hrefs.settings} onClick={() => props.onNavigate?.('settings')} aria-current={view === 'settings' ? 'page' : undefined}>Settings</Link>
          {props.onSignOut && <button type="button" onClick={props.onSignOut}>Sign out</button>}
        </div>
      </aside>

      <div className={s.column}>
        <header className={s.topbar}>
          <SendThanksLogo size={19} withIcon iconSize={32} />
          <span className={s.topbarAccount}>{accountName}{isDemo && <><br />FICTIONAL DEMO</>}</span>
          <button type="button" className={s.moreButton} aria-expanded={moreOpen} aria-label="More workspace links" onClick={() => setMoreOpen(value => !value)}>More</button>
          {moreOpen && <div className={s.moreMenu}>
            {MORE_NAV.map(item => <Link key={item.id} href={hrefs[item.id]} aria-current={item.id === view ? 'page' : undefined} onClick={() => { setMoreOpen(false); props.onNavigate?.(item.id); }}>{item.label}</Link>)}
            <Link href={hrefs.quickstart} onClick={() => { setMoreOpen(false); props.onNavigate?.('quickstart'); }}>Quickstart</Link>
            <Link href={hrefs.settings} onClick={() => { setMoreOpen(false); props.onNavigate?.('settings'); }}>Settings</Link>
            {props.onSignOut && <button type="button" onClick={() => { setMoreOpen(false); void props.onSignOut?.(); }}>Sign out</button>}
          </div>}
        </header>
        <div className={s.usageStrip} role="group" aria-label="Usage this month">
          <div className={s.usageStripText}><span><strong>{fmt(usage.sent)}</strong> send requests this month</span>{pct !== null && <strong>{pct}%</strong>}</div>
          <Meter usage={usage} />
        </div>

        <main className={s.main}>
          {view === 'detail' ? props.pageContent : <>
          <div className={s.pageHead}>
            <div><h1 className={s.h1}>{COPY[view][0]}</h1><p className={s.lede}>{COPY[view][1]}</p></div>
            {action && (
              <button type="button" className={s.primary} onClick={() => { setAdding(action.kind); setDraft(action.kind === 'key' ? 'Production' : ''); }}><Icon d={P.plus} size={18} width={3} />{action.label}</button>
            )}
          </div>

          {adding && (
            <form className={s.inlineForm} onSubmit={async event => {
              event.preventDefault();
              try {
                if (adding === 'domain') await props.onAddDomain?.(draft.trim());
                if (adding === 'block') await props.onAddBlockedAddress?.(draft.trim());
                if (adding === 'key') {
                  const secret = await props.onCreateApiKey?.(draft.trim());
                  if (secret) setCreatedKey(secret);
                }
                setAdding(null);
                setDraft('');
              } catch { /* The page shell announces the API error and keeps the form available. */ }
            }}>
              <label htmlFor="send-thanks-add-value">{adding === 'domain' ? 'Domain name' : adding === 'block' ? 'Email address' : 'Key name'}
                <input id="send-thanks-add-value" name="value" type={adding === 'block' ? 'email' : 'text'} autoComplete="off" value={draft} onChange={event => setDraft(event.target.value)} placeholder={adding === 'domain' ? 'example.com' : adding === 'block' ? 'person@example.com' : 'Production'} required maxLength={adding === 'key' ? 80 : 254} />
              </label>
              <div className={s.inlineFormActions}>
                <button type="submit" className={s.primary}>{adding === 'domain' ? 'Add domain' : adding === 'block' ? 'Add address' : 'Create key'}</button>
                <button type="button" className={s.secondary} onClick={() => { setAdding(null); setDraft(''); }}>Cancel</button>
              </div>
            </form>
          )}
          {createdKey && <div className={s.newKey} role="status">
            <div><strong>Your new API key</strong><p>Copy it now. It will not be shown again.</p></div>
            <code>{createdKey}</code>
            <button type="button" className={s.secondary} onClick={async () => { await navigator.clipboard.writeText(createdKey); setCopiedKey(true); window.setTimeout(() => setCopiedKey(false), 1800); }}>{copiedKey ? 'Copied' : 'Copy key'}</button>
            <button type="button" className={s.plainBtn} onClick={() => setCreatedKey('')}>Dismiss</button>
          </div>}

          <div className={`${s.grid} ${ov ? '' : s.single}`}>
            {(show.emails || show.keys) && (
              <div className={s.col}>
                {show.emails && (
                  <Card className={s.orderEmails} title={ov ? 'Recent emails' : 'All emails'} meta={ov ? `LATEST ${emails.length}` : `${emails.length} SHOWN`} action={seeAll('emails', 'See all emails', 'See all')}>
                    {!ov && (
                      <div className={s.toolbar} role="group" aria-label="Filter by status">
                        {(['All', ...availableStatuses] as const).map(f => (
                          <button key={f} type="button" className={s.chip} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                            {f}<span>{f === 'All' ? props.emails.length : props.emails.filter(e => e.status === f).length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={s.emailHead} aria-hidden="true"><span>STATUS</span><span>TO</span><span>SUBJECT</span><span style={{ textAlign: 'right' }}>SENT</span></div>
                    {emails.map(e => (
                      <div key={e.id} className={s.emailRow}>
                        <div className={s.eStatus}>
                          <StatusBadge label={e.status} />
                          <span className={`${s.eIdMobile} ${s.mono}`} title={e.id}>{shortEmailId(e.id)}</span>
                        </div>
                        <div className={s.eTo} title={e.to}>{e.to}</div>
                        <div className={s.eSubject}>
                          <strong title={e.subject}><Link className={s.emailDetailLink} href={`${hrefs.emails}/${encodeURIComponent(e.id)}`}>{e.subject}</Link></strong>
                          <span className={`${s.eIdDesktop} ${s.mono}`} title={e.id}>{shortEmailId(e.id)}</span>
                        </div>
                        <div className={s.eSent}>{e.sentAt}</div>
                      </div>
                    ))}
                    {emails.length === 0 && <div className={s.empty}>No email records match this view.</div>}
                    <p className={s.deliveryNote}>Sent means accepted for handoff. Signed delivery notifications update messages to Delivered, Bounced or Complained.</p>
                  </Card>
                )}
                {show.keys && (
                  <Card className={s.orderKeys} title="API keys" meta={`${props.apiKeys.filter(k => !k.revoked).length} ACTIVE`} action={seeAll('keys', 'Manage keys')}>
                    {props.apiKeys.map(k => (
                      <div key={k.id} className={s.row}>
                        <div className={s.rowMain}>
                          <div className={s.rowText}>
                            <span className={s.rowTitle}>{k.name}</span>
                            <span className={s.keyPrefix}>{k.prefix}</span>
                            <span className={s.rowMeta}>{k.permission} · Last used {k.lastUsed}</span>
                          </div>
                          {k.revoked && <StatusBadge label="Revoked" />}
                          {!ov && !k.revoked && props.onRevokeApiKey && confirm !== `k:${k.id}` && (
                            <button type="button" className={`${s.secondary} ${s.danger}`} onClick={() => setConfirm(`k:${k.id}`)}>Revoke</button>
                          )}
                        </div>
                        {confirm === `k:${k.id}` && (
                          <div role="alertdialog" aria-label="Confirm revoke" className={s.confirm}>
                            <div><strong>Revoke “{k.name}”?</strong> Anything using this key will stop sending straight away. This can't be undone.</div>
                            <div className={s.confirmActions}>
                              <button type="button" className={s.inkBtn} onClick={async () => { try { await props.onRevokeApiKey?.(k.id); setConfirm(null); } catch { /* The page shell announces action errors. */ } }}>Yes, revoke it</button>
                              <button type="button" className={s.plainBtn} onClick={() => setConfirm(null)}>Keep it</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}

            {(show.usage || show.domains || show.block) && (
              <div className={s.col}>
                {show.usage && (
                  <section aria-label="Usage" className={`${s.card} ${s.usage} ${s.orderUsage}`}>
                    <h2 className={s.h2}>Send requests this month</h2>
                    <div className={s.usageBig}>
                      <strong>{fmt(usage.sent)}</strong>
                      {usage.limit === null ? <><span>so far</span><span className={s.usageNote}>No monthly cap is configured.</span></> : `of ${fmt(usage.limit)} in your plan`}
                    </div>
                    <Meter usage={usage} large />
                    {usage.limit !== null && <div className={s.usageFoot}><span><strong>{pct}% used</strong> · {fmt(Math.max(0, usage.limit - usage.sent))} left</span><span>Resets {usage.resetsOn}</span></div>}
                  </section>
                )}
                {show.domains && (
                  <Card className={s.orderDomains} title="Sending domains" meta={`${verified}/${props.domains.length} VERIFIED`} action={seeAll('domains', 'Domains')}>
                    {props.domains.map(d => {
                      const isOpen = !ov && !!open[d.name];
                      return (
                        <div key={d.name} className={s.row}>
                          <div className={s.rowMain}>
                            <div className={s.rowText}><span className={s.rowTitle}>{d.name}</span><span className={s.rowMeta}>Added {d.addedAt}</span></div>
                            <StatusBadge label={d.status} />
                            {!ov && d.records && (
                              <button type="button" className={s.secondary} aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [d.name]: !o[d.name] }))}>
                                {isOpen ? 'Hide DNS records' : 'Show DNS records'}
                              </button>
                            )}
                            {!ov && d.status === 'Pending DNS' && props.onVerifyDomain && (
                              <button type="button" className={s.secondary} onClick={async () => { try { await props.onVerifyDomain?.(d.id); } catch { /* The page shell announces action errors. */ } }}>Check DNS record</button>
                            )}
                          </div>
                          {isOpen && d.records && (
                            <div className={s.dns}>
                              {d.status === 'Pending DNS' && <div>Add these records where your domain is managed. Sending starts once we can see them all, which can take up to 48 hours.</div>}
                              {d.records.map(r => (
                                <div key={r.type + r.name} className={s.record}>
                                  <span className={s.recordType}>{r.type}</span>
                                  <span className={s.recordName}>{r.name}</span>
                                  <span className={s.recordFound} data-found={r.found}>{r.found ? 'Found' : 'Not found yet'}</span>
                                  <span className={s.recordValue}>{r.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </Card>
                )}
                {show.block && (
                  <Card className={s.orderBlock} title="Block list" meta={`${props.blockList.length} ${props.blockList.length === 1 ? 'ADDRESS' : 'ADDRESSES'}`} action={seeAll('block', 'See all')}>
                    {adding === 'block' && <p className={s.helperText}>Enter an address to prevent future sends to it.</p>}
                    {!ov && (
                      <label className={s.search}>Search the block list
                        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Type an email address" />
                      </label>
                    )}
                    {blocked.map(b => (
                      <div key={b.address} className={s.row}>
                        <div className={s.rowMain}>
                          <div className={s.rowText}><span className={s.rowTitle} style={{ fontSize: 15 }}>{b.address}</span><span className={s.rowMeta}>Added {b.addedAt}</span></div>
                          <StatusBadge label={b.reason} />
                          {!ov && b.removable !== false && props.onRemoveBlockedAddress && confirm !== `b:${b.address}` && (
                            <button type="button" className={s.secondary} onClick={() => setConfirm(`b:${b.address}`)}>Remove</button>
                          )}
                        </div>
                        {confirm === `b:${b.address}` && (
                          <div role="alertdialog" aria-label="Confirm remove" className={`${s.confirm} ${s.soft}`}>
                            <div><strong>Take {b.address} off the block list?</strong> We'll start sending to them again.</div>
                            <div className={s.confirmActions}>
                              <button type="button" className={s.inkBtn} onClick={async () => { try { await props.onRemoveBlockedAddress?.(b.address); setConfirm(null); } catch { /* The page shell announces action errors. */ } }}>Yes, remove</button>
                              <button type="button" className={s.plainBtn} onClick={() => setConfirm(null)}>Keep blocked</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {!ov && blocked.length === 0 && (
                      <div className={s.empty}>{query ? `No blocked addresses match “${query}”.` : "Nobody's on your block list. Nice."}</div>
                    )}
                  </Card>
                )}
              </div>
            )}
            {!(view === 'overview' || view === 'emails' || view === 'domains' || view === 'block' || view === 'keys') && props.pageContent && <div className={s.col}>{props.pageContent}</div>}
          </div>
          </>}
          {isDemo && <div className={s.footnote}>All names, addresses, domains and keys shown are fictional demo data.</div>}
        </main>

        <nav aria-label="Dashboard" className={s.tabbar}>{navLinks(s.tab, 22, false)}</nav>
      </div>
    </div>
  );
}

export { CommaIcon };
