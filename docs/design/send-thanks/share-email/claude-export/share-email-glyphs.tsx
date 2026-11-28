import { Fragment, type ReactNode } from 'react';

/** 24-grid stroke glyphs for Share email. Same drawing rules as the dashboard's `P` map (round caps, currentColor). */
export const GLYPH = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 7v5l3.5 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  x: 'M7 7l10 10M17 7L7 17',
  send: 'M5 12h12M13 6l6 6-6 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  arrowLeft: 'M19 12H7M12 6l-6 6 6 6',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
} as const;

export function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9-]+\.)+(?:com|net|org|au|io|co|app|dev)(?:\/[^\s<>"']*)?)/gi;

/**
 * Renders a text/plain email body as text only. Paragraph breaks are kept with `white-space: pre-wrap`,
 * URLs are shown as text (no anchors, nothing fetched), and HTML is never interpreted.
 * For HTML-only emails use the text alternative; if there is none, show "No text version" rather than rendering HTML.
 */
export function MessageText({ text, className, urlClassName }: { text: string; className?: string; urlClassName?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(<Fragment key={last}>{text.slice(last, i)}</Fragment>);
    parts.push(<span key={`u${i}`} className={urlClassName}>{m[0]}</span>);
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={last}>{text.slice(last)}</Fragment>);
  return <div className={className}>{parts}</div>;
}

/** "Sun 29 Nov, 12:52 pm" in the viewer's zone. Pass your own formatter to the components if you already have one. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "in 48 hours", "in 12 minutes" or "expired". */
export function relativeToNow(iso: string, now: number = Date.now()): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}
