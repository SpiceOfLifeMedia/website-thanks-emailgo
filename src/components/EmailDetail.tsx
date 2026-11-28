'use client';
/**
 * Email, thanks · Email detail view with the Share email action.
 * Renders INSIDE the existing dashboard shell (sidebar / top bar / usage strip / tab bar) in place of the
 * Overview grid: see HANDOFF-share-email.md § Wiring. Presentational only: pass the email from your loader
 * and the two share handlers. Leave `onCreateShareLink` undefined and the Share email action is not rendered.
 */
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge, type EmailStatus } from './SendThanksDashboard';
import s from './send-thanks-dashboard.module.css';
import se from './share-email.module.css';
import ShareEmailDialog, { type ExpiryMinutes, type ShareLink } from './ShareEmailDialog';
import { GLYPH, Glyph, MessageText, formatDateTime as defaultFormat, relativeToNow } from './share-email-glyphs';

export interface DeliveryEvent {
  status: EmailStatus;
  /** ISO 8601 */
  at: string;
  /** Short note in words, e.g. "Confirmed by a signed delivery notification". */
  note: string;
}

export interface EmailDetailData {
  id: string;
  subject: string;
  /** Sending address, e.g. orders@goodyarn.com.au, with an optional display name. */
  from: string;
  fromName?: string;
  to: string;
  /** ISO 8601 */
  sentAt: string;
  status: EmailStatus;
  /** text/plain body. HTML is never rendered on this page. */
  text: string | null;
  hasAttachments?: boolean;
  events: DeliveryEvent[];
  /** The active share link, if any. */
  share?: ShareLink | null;
}

export interface EmailDetailProps {
  email: EmailDetailData;
  backHref?: string;
  onCreateShareLink?: (emailId: string, minutes: ExpiryMinutes) => Promise<ShareLink>;
  onRevokeShareLink?: (emailId: string, shareId: string) => Promise<void>;
  formatDateTime?: (iso: string) => string;
}

const timeOnly = (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

export default function EmailDetail({ email, backHref = '/dashboard/emails', onCreateShareLink, onRevokeShareLink, formatDateTime }: EmailDetailProps) {
  const fmt = formatDateTime ?? defaultFormat;
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ShareLink | null>(email.share ?? null);
  const [copied, setCopied] = useState(false);
  const canShare = !!onCreateShareLink && !!onRevokeShareLink;

  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* the dialog offers the select-and-copy fallback */ }
  }

  return (
    <>
      <div className={s.pageHead}>
        <div className={se.headText}>
          <Link href={backHref} className={se.backLink}><Glyph className={se.i} d={GLYPH.arrowLeft} />All emails</Link>
          <h1 className={se.subject}>{email.subject}</h1>
          <div className={se.detailMeta}>
            <StatusBadge label={email.status} />
            <span>to <strong>{email.to}</strong> · {fmt(email.sentAt)}</span>
            <span className={s.mono} title={email.id}>{email.id}</span>
          </div>
        </div>
        {canShare && (
          <div className={se.actions}>
            <button type="button" className={s.primary} onClick={() => setOpen(true)}>
              <Glyph className={se.i} d={GLYPH.link} />Share email
            </button>
          </div>
        )}
      </div>

      <div className={s.grid}>
        <div className={s.col}>
          <section aria-label="Message" className={`${s.card} ${se.orderMessage}`}>
            <div className={s.cardHead}><div className={s.cardTitle}><h2 className={s.h2}>Message</h2><span className={s.mono}>PLAIN TEXT</span></div></div>
            <div className={se.preview}>
              <div className={se.previewFrame}>
                <div className={se.previewBar}><Glyph className={se.i} d={GLYPH.shield} /><span>Preview · links shown as text · no images loaded</span></div>
                {email.text ? (
                  <MessageText text={email.text} className={se.previewBody} urlClassName={se.textUrl} />
                ) : (
                  <p className={se.previewBody}>This email has no text version, so there’s nothing safe to preview here.</p>
                )}
              </div>
            </div>
          </section>

          <section aria-label="Delivery" className={`${s.card} ${se.orderDelivery}`}>
            <div className={s.cardHead}><div className={s.cardTitle}><h2 className={s.h2}>Delivery</h2><span className={s.mono}>{email.events.length} {email.events.length === 1 ? 'EVENT' : 'EVENTS'}</span></div></div>
            <div className={se.steps}>
              {email.events.map(ev => (
                <div key={`${ev.status}-${ev.at}`} className={se.step}>
                  <span className={se.stepBadge}><StatusBadge label={ev.status} /></span>
                  <span className={se.stepText}>{ev.note}</span>
                  <span className={se.stepTime}>{timeOnly(ev.at)}</span>
                </div>
              ))}
            </div>
            <p className={s.cardNote}>Sent means accepted for handoff. Signed delivery notifications update messages to Delivered, Bounced or Complained.</p>
          </section>
        </div>

        <div className={s.col}>
          <section aria-label="Details" className={`${s.card} ${se.orderDetails}`}>
            <div className={s.cardHead}><div className={s.cardTitle}><h2 className={s.h2}>Details</h2></div></div>
            <dl className={se.dl}>
              <div className={se.dlRow}><dt>From</dt><dd>{email.fromName ? <>{email.fromName} <span className={s.mono}>‹{email.from}›</span></> : email.from}</dd></div>
              <div className={se.dlRow}><dt>To</dt><dd>{email.to}</dd></div>
              <div className={se.dlRow}><dt>Sent</dt><dd>{fmt(email.sentAt)}</dd></div>
              <div className={se.dlRow}><dt>Message ID</dt><dd><span className={s.mono} title={email.id}>{email.id}</span></dd></div>
            </dl>
          </section>

          <section aria-label="Sharing" className={`${s.card} ${se.orderShare}`}>
            {share ? (
              <>
                <div className={s.cardHead}>
                  <div className={s.cardTitle}><h2 className={s.h2}>Sharing</h2><span className={s.mono}>LINK ACTIVE</span></div>
                  <span className={`${s.badge} ${se['b-active']}`}><Glyph d={GLYPH.check} />Link active</span>
                </div>
                <div className={se.share}>
                  <p className={se.expiryLine}><Glyph className={se.i} d={GLYPH.clock} /><span>Expires <strong>{fmt(share.expiresAt)}</strong> · {relativeToNow(share.expiresAt)}</span></p>
                  <div className={se.linkRow}>
                    <span className={se.linkField} title={share.url}>{share.url}</span>
                    <button type="button" className={`${s.secondary} ${se.copyBtn}`} data-copied={copied} onClick={copy}>
                      <Glyph className={se.i} d={copied ? GLYPH.check : GLYPH.copy} />{copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                  <span className={se.srOnly} aria-live="polite">{copied ? 'Link copied to the clipboard' : ''}</span>
                  {canShare && <div><button type="button" className={`${s.secondary} ${s.danger}`} onClick={() => setOpen(true)}>Manage or revoke link</button></div>}
                </div>
              </>
            ) : (
              <>
                <div className={s.cardHead}><div className={s.cardTitle}><h2 className={s.h2}>Sharing</h2><span className={s.mono}>NOT SHARED</span></div></div>
                <div className={se.share}>
                  <p>This email hasn’t been shared. <strong>Share email</strong> creates a read-only link that expires on its own, so someone can read it without a Email, thanks account.</p>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {canShare && (
        <ShareEmailDialog
          open={open}
          subject={email.subject}
          link={share}
          onClose={() => setOpen(false)}
          onCreateLink={minutes => onCreateShareLink!(email.id, minutes)}
          onRevokeLink={() => share ? onRevokeShareLink!(email.id, share.shareId) : Promise.resolve()}
          onChange={setShare}
            hasAttachments={email.hasAttachments}
          formatDateTime={fmt}
        />
      )}
    </>
  );
}
