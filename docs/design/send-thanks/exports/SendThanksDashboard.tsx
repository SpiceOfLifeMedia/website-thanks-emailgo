'use client';
/**
 * Send, thanks: dashboard shell + Overview (selected direction 2b "Workbench").
 * Presentational only: pass data from your existing loaders and wire actions to your
 * EXISTING handlers. Any action prop left undefined is not rendered. This adds no new
 * backend operations.
 */
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { CommaIcon, SendThanksLogo } from './SendThanksLogo';
import s from './send-thanks-dashboard.module.css';

export type View = 'overview' | 'emails' | 'domains' | 'block' | 'keys';
/** Existing statuses only. Sent = accepted for handoff; Delivered/Bounced/Complained come from signed delivery notifications. */
export type EmailStatus = 'Queued' | 'Sent' | 'Deferred' | 'Failed' | 'Delivered' | 'Bounced' | 'Complained';
const STATUS_ORDER: EmailStatus[] = ['Queued', 'Sent', 'Deferred', 'Delivered', 'Bounced', 'Complained', 'Failed'];
export type DomainStatus = 'Verified' | 'Pending DNS';
export type BlockReason = 'Bounced' | 'Complained' | 'Added manually';

export interface EmailRow { id: string; to: string; subject: string; status: EmailStatus; sentAt: string }
export interface DnsRecord { type: string; name: string; value: string; found: boolean }
export interface DomainRow { name: string; status: DomainStatus; addedAt: string; records?: DnsRecord[] }
export interface ApiKeyRow { id: string; name: string; prefix: string; permission: string; lastUsed: string; revoked?: boolean }
export interface BlockRow { address: string; reason: BlockReason; addedAt: string }
/** limit: null when no monthly cap is configured. */
export interface Usage { sent: number; limit: number | null; resetsOn?: string }

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
  /** Slot for the existing phone top-bar control (e.g. the "More" menu button). */
  topbarAction?: ReactNode;
  onAddDomain?: () => void;
  onCreateApiKey?: () => void;
  onRevokeApiKey?: (id: string) => void | Promise<void>;
  onAddBlockedAddress?: () => void;
  onRemoveBlockedAddress?: (address: string) => void | Promise<void>;
}

const DEFAULT_HREFS: Record<View, string> = {
  overview: '/dashboard', emails: '/dashboard/emails', domains: '/dashboard/domains', block: '/dashboard/block-list', keys: '/dashboard/api-keys',
};

const P = {
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
  send: 'M5 12h12M13 6l6 6-6 6',
  retry: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
};

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'emails', label: 'Emails' }, { id: 'domains', label: 'Domains' },
  { id: 'block', label: 'Block list' }, { id: 'keys', label: 'API keys' },
];

const COPY: Record<View, [string, string]> = {
  overview: ['Overview', 'How your sending is going, at a glance.'],
  emails: ['Emails', 'Every email sent from your account, newest first.'],
  domains: ['Domains', 'The domains you send from. Each one needs a few DNS records before it can send.'],
  block: ['Block list', "We won't send to these addresses. Anyone who bounces or complains is added for you."],
  keys: ['API keys', 'Keys let your website and apps send email. Treat them like a password.'],
};

const BADGE: Record<string, { cls: string; icon: string }> = {
  Queued: { cls: '', icon: P.clock }, Sent: { cls: '', icon: P.send }, Deferred: { cls: '', icon: P.retry },
  Failed: { cls: 'b-failed', icon: P.x },
  Delivered: { cls: 'b-delivered', icon: P.check }, Verified: { cls: 'b-verified', icon: P.check },
  Bounced: { cls: 'b-bounced', icon: P.bounce }, Complained: { cls: 'b-complained', icon: P.flag },
  'Pending DNS': { cls: '', icon: P.clock }, 'Added manually': { cls: '', icon: P.block }, Revoked: { cls: 'b-revoked', icon: P.x },
};

const fmt = (n: number) => n.toLocaleString('en-AU');
/** Long IDs: first 10 + … + last 6. Always render the full value in title. */
export const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

function Meter({ usage, large }: { usage: Usage & { limit: number }; large?: boolean }) {
  const pct = Math.min(100, (usage.sent / usage.limit) * 100);
  return (
    <div role="meter" aria-label="Send requests this month" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.sent}
      className={`${s.meter} ${large ? s.meterLg : ''}`}>
      <div className={s.meterFill} style={{ width: `${pct.toFixed(1)}%` }} />
    </div>
  );
}

function Card({ title, meta, action, className, children }: { title: string; meta?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
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

  const emails = useMemo(() => {
    const list = ov || filter === 'All' ? props.emails : props.emails.filter(e => e.status === filter);
    return ov ? list.slice(0, 6) : list;
  }, [props.emails, filter, ov]);
  const blocked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !ov && q ? props.blockList.filter(b => b.address.toLowerCase().includes(q)) : props.blockList;
    return ov ? list.slice(0, 3) : list;
  }, [props.blockList, query, ov]);

  const action = view === 'domains' ? { label: 'Add a domain', fn: props.onAddDomain }
    : view === 'block' ? { label: 'Add an address', fn: props.onAddBlockedAddress }
    : view === 'keys' ? { label: 'Create an API key', fn: props.onCreateApiKey } : null;

  const show = { usage: ov, emails: ov || view === 'emails', domains: ov || view === 'domains', keys: ov || view === 'keys', block: ov || view === 'block' };
  const capped = usage.limit != null;
  const cap = usage as Usage & { limit: number };
  const pct = capped ? Math.round((usage.sent / cap.limit) * 100) : 0;
  const seeAll = (v: View, label: string) => ov ? <Link href={hrefs[v]} className={s.secondary}>{label}</Link> : null;
  const verified = props.domains.filter(d => d.status === 'Verified').length;
  const filters = (['All'] as const as readonly ('All' | EmailStatus)[]).concat(STATUS_ORDER.filter(f => props.emails.some(e => e.status === f)));

  const navLinks = (cls: string, iconSize: number, withCount: boolean) => NAV.map(n => (
    <Link key={n.id} href={hrefs[n.id]} className={cls} aria-current={n.id === view ? 'page' : undefined}>
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
        </div>
        <nav aria-label="Dashboard" className={s.nav}>{navLinks(s.navItem, 20, true)}</nav>
        <div className={s.sideUsage}>
          {capped ? (
            <><Meter usage={cap} /><span><strong>{fmt(usage.sent)}</strong> of {fmt(cap.limit)} requests this month</span></>
          ) : (
            <span><strong>{fmt(usage.sent)}</strong> requests this month</span>
          )}
        </div>
      </aside>

      <div className={s.column}>
        <header className={s.topbar}>
          <SendThanksLogo size={19} withIcon iconSize={32} />
          {props.topbarAction /* e.g. existing "More" menu trigger; account label is hidden on phone */}
        </header>
        <div className={s.usageStrip} role="group" aria-label="Usage this month">
          {capped ? (
            <>
              <div className={s.usageStripText}><span><strong>{fmt(usage.sent)}</strong> of {fmt(cap.limit)} send requests</span><strong>{pct}%</strong></div>
              <Meter usage={cap} />
            </>
          ) : (
            <div className={s.usageStripLine}><strong>{fmt(usage.sent)}</strong> send requests this month</div>
          )}
        </div>

        <main className={s.main}>
          <div className={s.pageHead}>
            <div><h1 className={s.h1}>{COPY[view][0]}</h1><p className={s.lede}>{COPY[view][1]}</p></div>
            {action?.fn && (
              <button type="button" className={s.primary} onClick={action.fn}><Icon d={P.plus} size={18} width={3} />{action.label}</button>
            )}
          </div>

          <div className={`${s.grid} ${ov ? '' : s.single}`}>
            {(show.emails || show.keys) && (
              <div className={s.col}>
                {show.emails && (
                  <Card className={s.orderEmails} title={ov ? 'Recent emails' : 'All emails'} meta={ov ? <><span className={s.idDesktop}>LATEST {emails.length}</span><span className={s.idMobile}>LATEST {Math.min(emails.length, 3)}</span></> : `${emails.length} SHOWN`} action={seeAll('emails', 'See all emails')}>
                    {!ov && (
                      <div className={s.toolbar} role="group" aria-label="Filter by status">
                        {filters.map(f => (
                          <button key={f} type="button" className={s.chip} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                            {f}<span>{f === 'All' ? props.emails.length : props.emails.filter(e => e.status === f).length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={s.emailHead} aria-hidden="true"><span>STATUS</span><span>TO</span><span>SUBJECT</span><span style={{ textAlign: 'right' }}>SENT</span></div>
                    {emails.map((e, i) => (
                      <div key={e.id} className={s.emailRow} data-phone-hidden={ov && i >= 3 ? 'true' : undefined}>
                        <div className={s.eStatus}>
                          <StatusBadge label={e.status} />
                          <span className={`${s.mono} ${s.idMobile}`} title={e.id}>{shortId(e.id)}</span>
                        </div>
                        <div className={s.eTo} title={e.to}>{e.to}</div>
                        <div className={s.eSubject}>
                          <strong title={e.subject}>{e.subject}</strong>
                          <span className={`${s.mono} ${s.idDesktop}`} title={e.id}>{shortId(e.id)}</span>
                        </div>
                        <div className={s.eSent}>{e.sentAt}</div>
                      </div>
                    ))}
                    <p className={s.cardNote}>Sent means accepted for handoff. Signed delivery notifications update messages to Delivered, Bounced or Complained.</p>
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
                              <button type="button" className={s.inkBtn} onClick={async () => { await props.onRevokeApiKey?.(k.id); setConfirm(null); }}>Yes, revoke it</button>
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
                    {capped ? (
                      <>
                        <div className={s.usageBig}><strong>{fmt(usage.sent)}</strong>of {fmt(cap.limit)} in your plan</div>
                        <Meter usage={cap} large />
                        <div className={s.usageFoot}><span><strong>{pct}% used</strong> · {fmt(cap.limit - usage.sent)} left</span>{usage.resetsOn && <span>Resets {usage.resetsOn}</span>}</div>
                      </>
                    ) : (
                      <div className={s.usageUncapped}>
                        <div className={s.usageBig}><strong>{fmt(usage.sent)}</strong><b>so far</b></div>
                        <span>No monthly cap is configured.</span>
                      </div>
                    )}
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
                  <Card className={s.orderBlock} title="Block list" meta={plural(props.blockList.length, 'ADDRESS', 'ADDRESSES')} action={seeAll('block', 'See all')}>
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
                          {!ov && props.onRemoveBlockedAddress && confirm !== `b:${b.address}` && (
                            <button type="button" className={s.secondary} onClick={() => setConfirm(`b:${b.address}`)}>Remove</button>
                          )}
                        </div>
                        {confirm === `b:${b.address}` && (
                          <div role="alertdialog" aria-label="Confirm remove" className={`${s.confirm} ${s.soft}`}>
                            <div><strong>Take {b.address} off the block list?</strong> We'll start sending to them again.</div>
                            <div className={s.confirmActions}>
                              <button type="button" className={s.inkBtn} onClick={async () => { await props.onRemoveBlockedAddress?.(b.address); setConfirm(null); }}>Yes, remove</button>
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
          </div>
          {isDemo && <div className={s.footnote}>All names, addresses, domains and keys shown are fictional demo data.</div>}
        </main>

        <nav aria-label="Dashboard" className={s.tabbar}>{navLinks(s.tab, 22, false)}</nav>
      </div>
    </div>
  );
}

export { CommaIcon };
