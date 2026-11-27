'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import styles from './contact-activity.module.css';

export interface ActivityEmailRef {
  id: string;
  subject?: string | null;
  href?: string | null;
}

export interface ContactFieldChange {
  field: string;
  from?: string | null;
  to?: string | null;
  added?: string[];
  removed?: string[];
}

interface ActivityBase {
  id: string;
  occurredAt: string;
}

export type ContactActivityItem =
  | (ActivityBase & { kind: 'contact_added'; source?: string | null })
  | (ActivityBase & { kind: 'contact_updated'; changes: ContactFieldChange[] })
  | (ActivityBase & { kind: 'email_sent' | 'email_received' | 'delivered' | 'opened' | 'complained'; email?: ActivityEmailRef | null })
  | (ActivityBase & { kind: 'delayed'; email?: ActivityEmailRef | null; reason?: string | null })
  | (ActivityBase & { kind: 'bounced'; email?: ActivityEmailRef | null; bounceType: 'Permanent' | 'Temporary' | 'Undetermined'; bounceSubtype?: string | null })
  | (ActivityBase & { kind: 'clicked'; email?: ActivityEmailRef | null; url?: string | null })
  | (ActivityBase & { kind: 'unsubscribed'; email?: ActivityEmailRef | null; method?: string | null });

export type ContactActivityKind = ContactActivityItem['kind'];

export interface ContactActivityPanelProps {
  contact: { id: string; email: string; name?: string | null };
  items: ContactActivityItem[];
  status: 'loading' | 'ready' | 'error';
  errorMessage?: string | null;
  hasMore: boolean;
  loadingMore?: boolean;
  loadMoreError?: string | null;
  variant?: 'inline' | 'sheet';
  panelId?: string;
  timeZone?: string;
  timeZoneLabel?: string;
  locale?: string;
  now?: string;
  onLoadMore: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onClose: () => void;
}

type Tone = 'plain' | 'paper' | 'basil' | 'honey' | 'tomato' | 'ink' | 'dashed';

const KIND: Record<ContactActivityKind, { label: string; icon: string; tone: Tone }> = {
  contact_added: { label: 'Contact added', icon: 'M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6', tone: 'paper' },
  contact_updated: { label: 'Contact updated', icon: 'M4 20h4L19 9l-4-4L4 16z', tone: 'paper' },
  email_sent: { label: 'Sent', icon: 'M21 3L3 10.5l7 3 3 7zM10 13.5L21 3', tone: 'plain' },
  email_received: { label: 'Received', icon: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z', tone: 'plain' },
  delivered: { label: 'Delivered', icon: 'M5 12.5l4.5 4.5L19 7.5', tone: 'basil' },
  delayed: { label: 'Delayed', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2', tone: 'honey' },
  bounced: { label: 'Bounced', icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', tone: 'tomato' },
  complained: { label: 'Complained', icon: 'M5 21V4M5 4h11l-2 4 2 4H5', tone: 'ink' },
  opened: { label: 'Opened', icon: 'M3 10l9-6 9 6v10H3zM3 10l9 6 9-6', tone: 'plain' },
  clicked: { label: 'Clicked', icon: 'M5 3l14 7-6 2-2 6z', tone: 'plain' },
  unsubscribed: { label: 'Unsubscribed', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM8 12h8', tone: 'dashed' },
};

function shortId(id: string) {
  return id.length > 12 ? id.slice(0, 7) + '…' + id.slice(-4) : id;
}

function changeText(change: ContactFieldChange): string | null {
  if (change.added?.length) return change.field + ' added: ' + change.added.join(', ');
  if (change.removed?.length) return change.field + ' removed: ' + change.removed.join(', ');
  if (change.from && change.to) return change.field + ': ' + change.from + ' → ' + change.to;
  if (change.to) return change.field + ' set to ' + change.to;
  if (change.from) return change.field + ' cleared (was ' + change.from + ')';
  return null;
}

function detailsOf(item: ContactActivityItem): string[] {
  switch (item.kind) {
    case 'bounced':
      return [[item.bounceType + ' bounce', item.bounceSubtype].filter(Boolean).join(' · ')];
    case 'delayed':
      return item.reason ? [item.reason] : [];
    case 'clicked':
      return item.url ? ['Link: ' + item.url] : [];
    case 'complained':
      return ['Marked as spam by the recipient'];
    case 'unsubscribed':
      return item.method ? [item.method] : [];
    case 'contact_added':
      return item.source ? ['Source: ' + item.source] : [];
    case 'contact_updated':
      return item.changes.map(changeText).filter((value): value is string => Boolean(value));
    default:
      return [];
  }
}

interface TimelineItem {
  id: string;
  iso: string;
  time: string;
  full: string;
  kind: ContactActivityKind;
  subject: string | null;
  details: string[];
  email: ActivityEmailRef | null;
}

interface TimelineGroup {
  key: string;
  label: string;
  items: TimelineItem[];
}

function useTimeline(items: ContactActivityItem[], locale: string, timeZone: string, now?: string) {
  return useMemo(() => {
    const timezone = { timeZone };
    const formatTime = new Intl.DateTimeFormat(locale, { ...timezone, hour: 'numeric', minute: '2-digit', hour12: true });
    const formatFull = new Intl.DateTimeFormat(locale, { ...timezone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short' });
    const formatKey = new Intl.DateTimeFormat('en-CA', { ...timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const formatDay = new Intl.DateTimeFormat(locale, { ...timezone, weekday: 'short', day: 'numeric', month: 'short' });
    const formatDayWithYear = new Intl.DateTimeFormat(locale, { ...timezone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const current = now ? new Date(now) : new Date();
    const today = formatKey.format(current);
    const yesterday = formatKey.format(new Date(current.getTime() - 864e5));
    const groups: TimelineGroup[] = [];
    let count = 0;

    for (const item of items) {
      if (!KIND[item.kind]) continue;
      const date = new Date(item.occurredAt);
      if (Number.isNaN(date.getTime())) continue;
      const details = detailsOf(item);
      if (item.kind === 'contact_updated' && details.length === 0) continue;
      const key = formatKey.format(date);
      let group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        const day = key.slice(0, 4) === today.slice(0, 4) ? formatDay.format(date) : formatDayWithYear.format(date);
        group = { key, label: key === today ? 'Today · ' + day : key === yesterday ? 'Yesterday · ' + day : day, items: [] };
        groups.push(group);
      }
      const email = 'email' in item && item.email ? item.email : null;
      group.items.push({ id: item.id, iso: item.occurredAt, time: formatTime.format(date), full: formatFull.format(date), kind: item.kind, subject: email?.subject ?? null, details, email });
      count += 1;
    }
    return { groups, count };
  }, [items, locale, timeZone, now]);
}

function Svg({ d, className }: { d: string; className?: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className={className ?? styles.svg}><path d={d} /></svg>;
}

export function ContactActivityPanel(props: ContactActivityPanelProps) {
  const {
    contact, items, status, errorMessage, hasMore, loadingMore = false, loadMoreError,
    variant = 'inline', timeZone = 'Australia/Adelaide', timeZoneLabel = 'Adelaide', locale = 'en-AU', now,
  } = props;
  const autoId = useId();
  const panelId = props.panelId ?? 'contact-activity-' + autoId;
  const titleId = panelId + '-title';
  const sheet = variant === 'sheet';
  const name = contact.name || contact.email;
  const timeline = useTimeline(items, locale, timeZone, now);
  const busy = status === 'loading' || loadingMore;
  const dialogRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    if (!sheet) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    doneRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [sheet]);

  const body = <>
    {status === 'loading' && <div className={styles.loading}>
      <div role="status" className={styles.loadingText}>Loading activity…</div>
      {['46%:68%', '38%:54%', '52%:40%'].map((widths, index) => {
        const [firstWidth, secondWidth] = widths.split(':');
        return <div key={index} className={styles.skelRow} aria-hidden="true">
          {!sheet && <div className={styles.skelTime} />}
          <div className={styles.skelIcon} />
          <div className={styles.skelLines}><div className={styles.skelA} style={{ width: firstWidth }} /><div className={styles.skelB} style={{ width: secondWidth }} /></div>
        </div>;
      })}
    </div>}

    {status === 'error' && <div role="alert" className={styles.error}>
      <div className={styles.errorText}>
        <div className={styles.stateTitle}>Couldn’t load activity</div>
        <div className={styles.stateBody}>{errorMessage || 'We couldn’t reach this contact’s activity just now. Nothing about the contact has changed.'}</div>
      </div>
      <button type="button" className={styles.btn} onClick={() => props.onRetry()}>Try again</button>
    </div>}

    {status === 'ready' && timeline.count === 0 && <div className={styles.empty}>
      <div className={styles.stateTitle}>No activity recorded yet</div>
      <div className={styles.stateBodyMuted}>When emails are sent to or received from {sheet ? 'this address' : contact.email}, each recorded step will show up here.</div>
    </div>}

    {status === 'ready' && timeline.count > 0 && <>
      <ol className={styles.groups}>
        {timeline.groups.map((group) => <li key={group.key}>
          <h4 className={styles.day}>{group.label}</h4>
          <ol className={styles.items}>
            {group.items.map((item, index) => {
              const kind = KIND[item.kind];
              const timestamp = <time dateTime={item.iso} title={item.full} className={styles.time}>{item.time}</time>;
              return <li key={item.id} className={styles.item}>
                {!sheet && timestamp}
                <div className={styles.rail}>
                  <span className={styles.spine} data-first={index === 0 || undefined} data-last={index === group.items.length - 1 || undefined} aria-hidden="true" />
                  <span className={styles.tile}><Svg d={kind.icon} className={styles.tileSvg} /></span>
                </div>
                <div className={styles.content}>
                  <div className={styles.headline}>
                    <span className={styles.badge + ' ' + styles[kind.tone]}>{kind.label}</span>
                    {!sheet && item.subject && <span className={styles.subject}>{item.subject}</span>}
                    {sheet && timestamp}
                  </div>
                  {sheet && item.subject && <div className={styles.subject}>{item.subject}</div>}
                  {item.details.map((detail, detailIndex) => <div key={detailIndex} className={styles.detail}>{detail}</div>)}
                  {item.email && <div className={styles.refText} title={item.email.id}>{shortId(item.email.id)}</div>}
                </div>
              </li>;
            })}
          </ol>
        </li>)}
      </ol>
      <div className={styles.footer}>
        {loadMoreError && <div role="alert" className={styles.moreError}>{loadMoreError}</div>}
        {hasMore && <button type="button" className={styles.more} onClick={() => props.onLoadMore()} disabled={loadingMore} aria-busy={loadingMore}>
          {loadingMore ? 'Loading older activity…' : loadMoreError ? 'Try loading older activity again' : 'Load older activity'}
        </button>}
        {!hasMore && <div className={styles.end}>That’s the start of the recorded activity.</div>}
        <div aria-live="polite" className={styles.count}>Showing {timeline.count} {timeline.count === 1 ? 'item' : 'items'}</div>
      </div>
    </>}
  </>;

  if (sheet) return <div ref={dialogRef} id={panelId} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} className={styles.sheet}>
    <div className={styles.sheetHead}>
      <div className={styles.sheetTitleBlock}>
        <h2 id={titleId} className={styles.sheetTitle}>Activity<span className={styles.srOnly}> for {name}</span></h2>
        {contact.name && <div className={styles.sheetName}>{contact.name}</div>}
        <div className={styles.sheetEmail}>{contact.email}</div>
      </div>
      <button ref={doneRef} type="button" className={styles.done} onClick={props.onClose}>Done</button>
    </div>
    <div className={styles.sheetBody}>
      <div className={styles.metaLine}>Newest first · Times in {timeZoneLabel}</div>
      {body}
    </div>
  </div>;

  return <div id={panelId} role="region" aria-labelledby={titleId} aria-busy={busy} className={styles.inlineWrap}>
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitleBlock}>
          <h3 id={titleId} className={styles.panelTitle}>Activity<span className={styles.srOnly}> for {name}</span></h3>
          <span className={styles.metaLine}>Newest first · Times in {timeZoneLabel}</span>
        </div>
        <button type="button" className={styles.btn} onClick={props.onClose}>Close</button>
      </div>
      <div className={styles.panelBody}>{body}</div>
    </div>
  </div>;
}

export default ContactActivityPanel;
