/**
 * Email, thanks · Public read-only shared email (no dashboard shell, no sign-in).
 * Server component friendly: no hooks. Pass `email: null` for an expired, revoked or unknown link;
 * all three render the same "isn’t available" page so a visitor can’t tell which it was.
 * Never pass BCC (or CC) here: the data shape doesn’t have them on purpose.
 */
import { SendThanksLogo } from './SendThanksLogo';
import se from './share-email.module.css';
import { GLYPH, Glyph, MessageText, formatDateTime as defaultFormat } from './share-email-glyphs';

export interface SharedEmailData {
  subject: string;
  from: string;
  fromName?: string;
  to: string;
  /** ISO 8601 */
  sentAt: string;
  /** text/plain body only. */
  text: string | null;
  /** Whether source attachments were omitted from this read-only view. */
  hasAttachments?: boolean;
  /** ISO 8601; the server enforces it, this is display only. */
  expiresAt: string;
}

export interface SharedEmailPageProps {
  email: SharedEmailData | null;
  loading?: boolean;
  /** Where the logo links, e.g. your marketing site. Omit to render the lockup without a link. */
  homeHref?: string;
  formatDateTime?: (iso: string) => string;
}

export default function SharedEmailPage({ email, loading = false, homeHref, formatDateTime }: SharedEmailPageProps) {
  const fmt = formatDateTime ?? defaultFormat;
  const lockup = <SendThanksLogo size={21} withIcon iconSize={32} />;
  const smallLockup = <SendThanksLogo size={17} withIcon iconSize={24} />;

  return (
    <div className={se.pub}>
      <header className={se.pubBar}>
        {homeHref ? <a href={homeHref} className={se.logo} aria-label="Email, thanks">{lockup}</a> : <span className={se.logo}>{lockup}</span>}
        <span className={`${se.badge} ${se['b-shared']}`}><Glyph d={GLYPH.link} />Shared email</span>
      </header>

      {loading ? (
        <main className={`${se.pubMain} ${se.center}`}>
          <div className={`${se.pubCol} ${se.narrow}`}>
            <section className={`${se.pubCard} ${se.gone}`} aria-busy="true" aria-live="polite">
              <div className={se.goneIcon}><Glyph className={se.i} d={GLYPH.clock} /></div>
              <span className={`${se.badge} ${se['b-shared']}`}><Glyph d={GLYPH.link} />Shared email</span>
              <h1 className={se.goneTitle}>Opening this shared email</h1>
              <p className={se.goneText}>Checking that this link is still available.</p>
            </section>
          </div>
        </main>
      ) : email ? (
        <main className={se.pubMain}>
          <div className={se.pubCol}>
            <article className={se.pubCard} aria-labelledby="shared-subject">
              <div className={se.pubHead}>
                <div className={se.pubLabelRow}>
                  <span className={se.mono}>SHARED EMAIL · READ-ONLY COPY</span>
                  <p className={se.expiryLine}><Glyph className={se.i} d={GLYPH.clock} /><span>Expires <strong>{fmt(email.expiresAt)}</strong></span></p>
                </div>
                <h1 className={se.pubSubject} id="shared-subject">{email.subject}</h1>
                <dl className={`${se.dl} ${se.pubMeta}`}>
                  <div className={se.dlRow}><dt>From</dt><dd>{email.fromName ? <>{email.fromName} <span className={se.mono}>‹{email.from}›</span></> : email.from}</dd></div>
                  <div className={se.dlRow}><dt>To</dt><dd>{email.to}</dd></div>
                  <div className={se.dlRow}><dt>Date</dt><dd>{fmt(email.sentAt)}</dd></div>
                </dl>
              </div>
              <div className={se.pubBody}>
                <div className={se.previewFrame}>
                  <div className={se.previewBar}><Glyph className={se.i} d={GLYPH.shield} /><span>Message · links shown as text · no images loaded</span></div>
                  {email.text ? (
                    <MessageText text={email.text} className={`${se.previewBody} ${se.lg}`} urlClassName={se.textUrl} />
                  ) : (
                    <p className={`${se.previewBody} ${se.lg}`}>This email has no text version, so there’s nothing to show here.</p>
                  )}
                </div>
              </div>
              <p className={se.pubFoot}>This read-only copy was shared from the sender’s Email, thanks account. It stops working on {fmt(email.expiresAt)}.</p>
            </article>
            <p className={se.pubNotice}><Glyph className={se.i} d={GLYPH.lock} /><span>Only people with this link can see this page. It can’t be replied to or forwarded from here, and the person who shared it can turn it off at any time.</span></p>
            {email.hasAttachments && <p className={se.pubNotice}>Attachment files aren’t included in this shared copy.</p>}
          </div>
        </main>
      ) : (
        <main className={`${se.pubMain} ${se.center}`}>
          <div className={`${se.pubCol} ${se.narrow}`}>
            <section className={`${se.pubCard} ${se.gone}`} aria-labelledby="gone-title">
              <div className={se.goneIcon}><Glyph className={se.i} d={GLYPH.clock} /></div>
              <span className={`${se.badge} ${se['b-expired']}`}><Glyph d={GLYPH.x} />Link unavailable</span>
              <h1 className={se.goneTitle} id="gone-title">This link isn’t available</h1>
              <p className={se.goneText}>It may have expired, or the person who shared it may have turned it off. If you still need the email, ask them to share it again.</p>
              <span className={se.mono}>SHARED LINKS LAST 48 HOURS AT MOST</span>
            </section>
            <p className={se.pubNotice}><Glyph className={se.i} d={GLYPH.lock} /><span>Nothing from the email is shown on this page. Shared emails are read-only and stop working when their link expires or is revoked.</span></p>
          </div>
        </main>
      )}

      <footer className={se.pubFooter}>
        <span className={se.logo}>{smallLockup}</span>
        <span>Shared emails are read-only and expire on their own.</span>
      </footer>
    </div>
  );
}
