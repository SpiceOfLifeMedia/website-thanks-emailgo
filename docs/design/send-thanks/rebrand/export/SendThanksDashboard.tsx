'use client';

import { useMemo } from 'react';
import { SendThanksLogo } from './SendThanksLogo';
import styles from './send-thanks-dashboard.module.css';

/* ---------- Serializable props ---------- */
export type NavId = 'overview' | 'emails' | 'domains' | 'keys' | 'block';
export type EmailStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed';
export type EmailFilter = 'all' | 'delivered' | 'bounced' | 'complained';
export type DomainStatus = 'verified' | 'pending' | 'failed';
export type BlockReason = 'bounced' | 'complained' | 'manual';

export interface RecentEmail { id: string; to: string; subject: string; status: EmailStatus; sentAt: string }
export interface SendingDomain { id: string; name: string; status: DomainStatus }
export interface ApiKeySummary { id: string; name: string; /** already masked, e.g. "st_live_4f2a…91c0" */ maskedKey: string; lastUsedAt: string | null }
export interface BlockedAddress { id: string; address: string; reason: BlockReason; blockedAt: string }
export interface UsageSummary { used: number; /** null = no monthly cap configured */ limit: number | null; resetsOn?: string | null }

export interface SendThanksDashboardProps {
  accountName: string;
  activeNav?: NavId;
  usage: UsageSummary;
  recentEmails: RecentEmail[];
  /** Counts per filter for the chips; falls back to counting recentEmails */
  emailCounts?: Partial<Record<EmailFilter, number>>;
  emailFilter: EmailFilter;
  domains: SendingDomain[];
  apiKeys: ApiKeySummary[];
  blockList: BlockedAddress[];
  blockListTotal?: number;
  /** Section-level messages from the page; shown in place of that section's list */
  errors?: Partial<Record<'emails' | 'domains' | 'keys' | 'block' | 'usage', string>>;
  notice?: string | null;
  layout?: 'desktop' | 'mobile';
  timeZone?: string;
  locale?: string;
  now?: string;
  onNavigate: (id: NavId) => void;
  onEmailFilterChange: (filter: EmailFilter) => void;
  onOpenEmail: (id: string) => void;
  onViewAllEmails: () => void;
  onAddDomain: () => void;
  onOpenDomain: (id: string) => void;
  onCreateApiKey: () => void;
  onViewBlockList: () => void;
  onUnblock: (id: string) => void;
  onDismissNotice?: () => void;
}

/* ---------- Words + shapes for every state (colour is never the only signal) ---------- */
const I = {
  tick: 'M5 12.5l4.5 4.5L19 7.5', clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2', plane: 'M21 3L3 10.5l7 3 3 7zM10 13.5L21 3',
  bounce: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', cross: 'M6 6l12 12M18 6L6 18',
  block: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8', plus: 'M12 5v14M5 12h14',
};
const EMAIL: Record<EmailStatus, { label: string; tone: string; icon: string }> = {
  queued: { label: 'Queued', tone: 'tQueued', icon: I.clock }, sent: { label: 'Sent', tone: 'tSent', icon: I.plane },
  delivered: { label: 'Delivered', tone: 'tDelivered', icon: I.tick }, bounced: { label: 'Bounced', tone: 'tBounced', icon: I.bounce },
  complained: { label: 'Complained', tone: 'tComplained', icon: I.flag }, failed: { label: 'Failed', tone: 'tFailed', icon: I.cross },
};
const DOMAIN: Record<DomainStatus, { label: string; tone: string; icon: string }> = {
  verified: { label: 'Verified', tone: 'tDelivered', icon: I.tick }, pending: { label: 'Pending', tone: 'tPending', icon: I.clock }, failed: { label: 'Failed', tone: 'tFailed', icon: I.cross },
};
const REASON: Record<BlockReason, { label: string; tone: string; icon: string }> = {
  bounced: { label: 'Bounced', tone: 'tBounced', icon: I.bounce }, complained: { label: 'Complained', tone: 'tComplained', icon: I.flag }, manual: { label: 'Added by you', tone: 'tSent', icon: I.block },
};
const NAV: { id: NavId; label: string; short: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z' },
  { id: 'emails', label: 'Emails', short: 'Emails', icon: 'M3 6h18v12H3zM3 7l9 6 9-6' },
  { id: 'domains', label: 'Domains', short: 'Domains', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18' },
  { id: 'keys', label: 'API keys', short: 'Keys', icon: 'M15 3a6 6 0 1 1-5.2 9L3 18.8V21h3v-2h2v-2h2l1.8-1.8A6 6 0 0 1 15 3zM16.5 7.5h.01' },
  { id: 'block', label: 'Block list', short: 'Blocked', icon: I.block },
];
const FILTERS: [EmailFilter, string][] = [['all', 'All'], ['delivered', 'Delivered'], ['bounced', 'Bounced'], ['complained', 'Complained']];

const Svg = ({ d, size = 14, className }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className ?? styles.svg}><path d={d} /></svg>
);
const Badge = ({ label, tone, icon, small }: { label: string; tone: string; icon: string; small?: boolean }) => (
  <span className={`${styles.badge} ${small ? styles.badgeSm : ''} ${styles[tone]}`}><Svg d={icon} size={small ? 13 : 14} className={styles.svgBold} />{label}</span>
);

export function SendThanksDashboard(p: SendThanksDashboardProps) {
  const { layout = 'desktop', activeNav = 'overview', timeZone = 'Australia/Sydney', locale = 'en-AU', errors = {} } = p;
  const mobile = layout === 'mobile';

  const f = useMemo(() => {
    const tz = { timeZone };
    const key = new Intl.DateTimeFormat('en-CA', { ...tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = new Intl.DateTimeFormat(locale, { ...tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const day = new Intl.DateTimeFormat(locale, { ...tz, day: 'numeric', month: 'short' });
    const full = new Intl.DateTimeFormat(locale, { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
    const n = p.now ? new Date(p.now) : new Date();
    const today = key.format(n), yday = key.format(new Date(n.getTime() - 864e5));
    const rel = (iso: string) => { const d = new Date(iso), k = key.format(d); return k === today ? time.format(d) : k === yday ? 'Yesterday' : day.format(d); };
    return { rel, full: (iso: string) => full.format(new Date(iso)), day: (iso: string) => day.format(new Date(iso)), num: new Intl.NumberFormat(locale) };
  }, [timeZone, locale, p.now]);

  const counts: Record<EmailFilter, number> = {
    all: p.emailCounts?.all ?? p.recentEmails.length,
    delivered: p.emailCounts?.delivered ?? p.recentEmails.filter(e => e.status === 'delivered').length,
    bounced: p.emailCounts?.bounced ?? p.recentEmails.filter(e => e.status === 'bounced').length,
    complained: p.emailCounts?.complained ?? p.recentEmails.filter(e => e.status === 'complained').length,
  };
  const emails = p.emailFilter === 'all' ? p.recentEmails : p.recentEmails.filter(e => e.status === p.emailFilter);
  const { used, limit } = p.usage;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const blockTotal = p.blockListTotal ?? p.blockList.length;
  const sectionError = (k: keyof NonNullable<SendThanksDashboardProps['errors']>) => errors[k] && <div role="alert" className={styles.error}>{errors[k]}</div>;

  const navButtons = (cls: string, short: boolean) => NAV.map(n => (
    <button key={n.id} type="button" className={`${cls} ${n.id === activeNav ? styles.on : ''}`} aria-current={n.id === activeNav ? 'page' : undefined} onClick={() => p.onNavigate(n.id)}>
      <Svg d={n.icon} size={short ? 22 : 20} />{short ? n.short : <span className={styles.grow}>{n.label}</span>}
    </button>
  ));

  return (
    <div className={mobile ? styles.shellM : styles.shell}>
      {!mobile && (
        <aside className={styles.sidebar}>
          <div className={styles.brand}><SendThanksLogo withIcon iconSize={32} size={21} /></div>
          <div className={styles.account}><span className={styles.monoLabel}>ACCOUNT</span><span className={styles.accountName}>{p.accountName}</span></div>
          <nav aria-label="Dashboard" className={styles.nav}>{navButtons(styles.navItem, false)}</nav>
        </aside>
      )}
      <div className={styles.main}>
        {mobile && <header className={styles.topbar}><SendThanksLogo withIcon iconSize={32} size={19} /></header>}
        <div className={styles.scroll}>
          <div className={styles.content}>
            <div className={styles.head}>
              <div className={styles.stack}><h1 className={styles.h1}>Overview</h1><p className={styles.lead}>What’s been sent, where it went, and what needs a look.</p></div>
              {p.notice && <div role="status" className={styles.notice}><span>{p.notice}</span>{p.onDismissNotice && <button type="button" className={styles.btn} onClick={p.onDismissNotice}>OK</button>}</div>}
            </div>

            <div className={styles.top}>
              <section aria-labelledby="st-recent" className={`${styles.card} ${styles.recent}`}>
                <div className={styles.cardHead}>
                  <div className={styles.titleLine}><h2 id="st-recent" className={styles.h2}>Recent emails</h2><span className={styles.mono}>{emails.length} SHOWN</span></div>
                  <button type="button" className={styles.btn} onClick={p.onViewAllEmails}>View all emails</button>
                </div>
                <div role="group" aria-label="Show emails" className={styles.filters}>
                  {FILTERS.map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={p.emailFilter === id} className={`${styles.filter} ${p.emailFilter === id ? styles.on : ''}`} onClick={() => p.onEmailFilterChange(id)}>
                      {label}<span className={styles.mono}>{counts[id]}</span>
                    </button>))}
                </div>
                {sectionError('emails')}
                {!errors.emails && emails.length === 0 && <div className={styles.empty}>{p.recentEmails.length ? 'No emails with this status in the recent list.' : 'No emails sent yet. They’ll show up here as soon as you send one.'}</div>}
                {!errors.emails && emails.length > 0 && (<>
                  {!mobile && <div className={styles.tableHead} aria-hidden="true"><div>TO</div><div>SUBJECT</div><div>STATUS</div><div>SENT</div></div>}
                  <ul aria-label="Recent emails" className={styles.list}>
                    {emails.map(e => { const s = EMAIL[e.status], when = f.rel(e.sentAt); return (
                      <li key={e.id} className={styles.li}>
                        <button type="button" className={mobile ? styles.emailCard : styles.emailRow} onClick={() => p.onOpenEmail(e.id)} aria-label={`${s.label}. To ${e.to}. ${e.subject}. ${when}`}>
                          {mobile ? (<>
                            <span className={styles.emailTop}><span className={styles.to}>{e.to}</span><time dateTime={e.sentAt} className={styles.when}>{when}</time></span>
                            <span className={styles.subjectWrap}>{e.subject}</span>
                            <Badge {...s} />
                          </>) : (<>
                            <span className={styles.to} title={e.to}>{e.to}</span>
                            <span className={styles.subject} title={e.subject}>{e.subject}</span>
                            <span><Badge {...s} /></span>
                            <time dateTime={e.sentAt} title={f.full(e.sentAt)} className={styles.when}>{when}</time>
                          </>)}
                        </button>
                      </li>); })}
                  </ul>
                </>)}
              </section>

              <div className={styles.side}>
                <section aria-labelledby="st-usage" className={`${styles.card} ${styles.usage}`}>
                  <h2 id="st-usage" className={styles.h2sm}>Usage this month</h2>
                  {errors.usage ? sectionError('usage') : (<>
                    <div className={styles.usageLine}><span className={styles.big}>{f.num.format(used)}</span>
                      <span className={styles.muted}>{limit ? `of ${f.num.format(limit)} emails` : 'emails so far'}</span></div>
                    {limit ? (<>
                      <div role="meter" aria-label="Emails sent this month" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-valuetext={`${f.num.format(used)} of ${f.num.format(limit)} emails, ${pct}%`} className={styles.meter}>
                        <div className={styles.meterFill} style={{ width: `${pct}%` }} />
                      </div>
                      <div className={styles.usageFoot}><span><strong>{pct}%</strong> used</span>{p.usage.resetsOn && <span>Resets {f.day(p.usage.resetsOn)}</span>}</div>
                    </>) : <div className={styles.muted}>No monthly cap is configured.</div>}
                  </>)}
                </section>

                <section aria-labelledby="st-domains" className={styles.card}>
                  <div className={styles.cardHeadSm}><h2 id="st-domains" className={styles.h2sm}>Sending domains</h2>
                    <button type="button" className={styles.btnPrimary} onClick={p.onAddDomain}><Svg d={I.plus} className={styles.svgBold} />Add domain</button></div>
                  {sectionError('domains')}
                  {!errors.domains && !p.domains.length && <div className={styles.empty}>No sending domains yet. Add one to start sending from your own address.</div>}
                  <ul aria-label="Sending domains" className={styles.list}>
                    {p.domains.map(d => (
                      <li key={d.id} className={styles.li}>
                        <button type="button" className={styles.domainRow} onClick={() => p.onOpenDomain(d.id)} aria-label={`${d.name}, ${DOMAIN[d.status].label}`}>
                          <span className={styles.domain}>{d.name}</span><Badge {...DOMAIN[d.status]} />
                        </button>
                      </li>))}
                  </ul>
                </section>
              </div>
            </div>

            <div className={styles.bottom}>
              <section aria-labelledby="st-keys" className={styles.card}>
                <div className={styles.cardHeadSm}><h2 id="st-keys" className={styles.h2sm}>API keys</h2>
                  <button type="button" className={styles.btn} onClick={p.onCreateApiKey}><Svg d={I.plus} className={styles.svgBold} />Create key</button></div>
                {sectionError('keys')}
                {!errors.keys && !p.apiKeys.length && <div className={styles.empty}>No API keys yet.</div>}
                <ul aria-label="API keys" className={styles.list}>
                  {p.apiKeys.map(k => (
                    <li key={k.id} className={`${styles.li} ${styles.keyRow}`}>
                      <span className={styles.stackTight}><span className={styles.keyName}>{k.name}</span><span className={styles.mono}>{k.maskedKey}</span></span>
                      <span className={styles.when}>{k.lastUsedAt ? `Used ${f.rel(k.lastUsedAt)}` : 'Never used'}</span>
                    </li>))}
                </ul>
              </section>

              <section aria-labelledby="st-block" className={styles.card}>
                <div className={styles.cardHeadSm}>
                  <div className={styles.titleLine}><h2 id="st-block" className={styles.h2sm}>Block list</h2><span className={styles.mono}>{blockTotal} {blockTotal === 1 ? 'ADDRESS' : 'ADDRESSES'}</span></div>
                  <button type="button" className={styles.btn} onClick={p.onViewBlockList}>View all</button>
                </div>
                {sectionError('block')}
                {!errors.block && !p.blockList.length && <div className={styles.empty}>No blocked addresses. Addresses that bounce or complain show up here.</div>}
                <ul aria-label="Blocked addresses" className={styles.list}>
                  {p.blockList.map(b => (
                    <li key={b.id} className={`${styles.li} ${styles.blockRow}`}>
                      <span className={styles.stackTight}><span className={styles.address}>{b.address}</span>
                        <span className={styles.blockMeta}><Badge {...REASON[b.reason]} small /><span className={styles.when}>Blocked {f.rel(b.blockedAt)}</span></span></span>
                      <button type="button" className={`${styles.btn} ${styles.btnDanger}`} aria-label={`Unblock ${b.address}`} onClick={() => p.onUnblock(b.id)}>Unblock</button>
                    </li>))}
                </ul>
              </section>
            </div>
          </div>
        </div>
        {mobile && <nav aria-label="Dashboard" className={styles.bottomNav}>{navButtons(styles.tab, true)}</nav>}
      </div>
    </div>
  );
}

export default SendThanksDashboard;
