'use client';
/**
 * Send, thanks · Share email dialog (desktop) / bottom sheet (phone).
 * Presentational. Wire `onCreateLink` and `onRevokeLink` to your handlers; the dialog shows the
 * busy, error, created, copied and revoked states itself. Native <dialog> + showModal() gives the
 * focus trap, inert page, Esc and focus return for free.
 */
import { useEffect, useId, useRef, useState } from 'react';
import s from './send-thanks-dashboard.module.css';
import se from './share-email.module.css';
import { GLYPH, Glyph, formatDateTime as defaultFormat, relativeToNow } from './share-email-glyphs';

export type ExpiryMinutes = 10 | 60 | 1440 | 2880;
export const EXPIRY_OPTIONS: ReadonlyArray<{ minutes: ExpiryMinutes; label: string; relative: string }> = [
  { minutes: 10, label: '10 minutes', relative: 'in 10 minutes' },
  { minutes: 60, label: '1 hour', relative: 'in 1 hour' },
  { minutes: 1440, label: '24 hours', relative: 'in 24 hours' },
  { minutes: 2880, label: '48 hours', relative: 'in 48 hours' },
];
export const DEFAULT_EXPIRY: ExpiryMinutes = 2880;

/** An active share link. `expiresAt` is ISO 8601, set by the server. */
export interface ShareLink { url: string; expiresAt: string; shareId: string }

export interface ShareEmailDialogProps {
  open: boolean;
  /** Subject of the email being shared, quoted in the intro. */
  subject: string;
  /** The link that already exists for this email, if any. Opens straight into the created state. */
  link?: ShareLink | null;
  onClose: () => void;
  onCreateLink: (minutes: ExpiryMinutes) => Promise<ShareLink>;
  onRevokeLink: () => Promise<void>;
  /** Called after a link is created or revoked so the page can update its Sharing card. */
  onChange?: (link: ShareLink | null) => void;
  /** True when the source message has files that are not included in the read-only link. */
  hasAttachments?: boolean;
  formatDateTime?: (iso: string) => string;
}

type Step = 'choose' | 'created' | 'revoked';

const COPY = {
  warn: 'Anyone with this link can view this email until it expires.',
  createFailed: 'We couldn’t create the link. Check your connection and try again.',
  revokeFailed: 'We couldn’t revoke the link. Try again.',
  copyFailed: 'Copy didn’t work. Select the link and copy it yourself.',
};

export default function ShareEmailDialog(props: ShareEmailDialogProps) {
  const { open, subject, onClose, onCreateLink, onRevokeLink, onChange, hasAttachments = false } = props;
  const fmt = props.formatDateTime ?? defaultFormat;
  const dlgRef = useRef<HTMLDialogElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const linkId = useId();

  const [step, setStep] = useState<Step>(props.link ? 'created' : 'choose');
  const [link, setLink] = useState<ShareLink | null>(props.link ?? null);
  const [expiry, setExpiry] = useState<ExpiryMinutes>(DEFAULT_EXPIRY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Open / close the native dialog and set initial focus.
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open) {
      setStep(props.link ? 'created' : 'choose');
      setLink(props.link ?? null);
      setError(null); setCopied(false); setCopyError(false); setConfirming(false);
      if (!dlg.open) dlg.showModal();
      // Checked chip first so arrow keys change the choice straight away; Copy link once a link exists.
      const target = props.link ? copyRef.current : dlg.querySelector<HTMLInputElement>('input[type=radio]:checked');
      target?.focus();
    } else if (dlg.open) {
      dlg.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { if (step === 'created') copyRef.current?.focus(); }, [step]);

  const option = EXPIRY_OPTIONS.find(o => o.minutes === expiry) ?? EXPIRY_OPTIONS[3];
  const previewExpiry = fmt(new Date(Date.now() + expiry * 60_000).toISOString());

  async function create() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const created = await onCreateLink(expiry);
      setLink(created); setStep('created'); onChange?.(created);
    } catch {
      setError(COPY.createFailed);
    } finally { setBusy(false); }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true); setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      linkRef.current?.select();
    }
  }

  async function revoke() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await onRevokeLink();
      setLink(null); setStep('revoked'); setConfirming(false); onChange?.(null);
    } catch {
      setError(COPY.revokeFailed);
    } finally { setBusy(false); }
  }

  return (
    <dialog ref={dlgRef} className={se.dlg} aria-labelledby={titleId} onClose={onClose}>
      {step === 'choose' && (
        <>
          <div className={se.dlgHead}>
            <div className={se.dlgTitle}><h2 className={s.h2} id={titleId}>Share this email</h2></div>
            <button type="button" className={se.closeBtn} onClick={onClose} aria-label="Close"><Glyph className={se.i} d={GLYPH.x} /></button>
          </div>
          <div className={se.dlgBody}>
            <p className={se.dlgIntro}>Create a link to a read-only copy of <strong>“{subject}”</strong>. Anyone with the link can open it, no account needed.</p>
            <fieldset className={se.fieldset}>
              <legend className={se.legend}>Link expires in</legend>
              <div className={se.chips}>
                {EXPIRY_OPTIONS.map(o => (
                  <span key={o.minutes} className={se.chip}>
                    <input className={se.chipRadio} type="radio" name="expiry" id={`${linkId}-${o.minutes}`} value={o.minutes}
                      checked={expiry === o.minutes} onChange={() => setExpiry(o.minutes)} />
                    <label className={se.chipLabel} htmlFor={`${linkId}-${o.minutes}`}>{o.label}</label>
                  </span>
                ))}
              </div>
              <p className={se.expiryNote}>Expires <strong>{previewExpiry}</strong> · {option.relative}</p>
            </fieldset>
            <div className={se.warn}>
              <Glyph className={se.i} d={GLYPH.eye} />
              <div><strong>{COPY.warn}</strong>BCC recipients are never shown, and you can revoke the link at any time.{hasAttachments && <> Attachment files aren’t included.</>}</div>
            </div>
            {error && (
              <div className={`${se.warn} ${se.err}`} role="alert">
                <Glyph className={se.i} d={GLYPH.alert} />
                <div><strong>{error}</strong>Your expiry choice is kept.</div>
              </div>
            )}
          </div>
          <div className={se.dlgActions}>
            <button type="button" className={`${s.primary} ${se.md} ${busy ? se.busy : ''}`} onClick={create} aria-busy={busy}>
              <Glyph className={se.i} d={GLYPH.link} />{busy ? 'Creating link…' : 'Create link'}
            </button>
            <button type="button" className={`${s.plainBtn} ${se.md}`} onClick={onClose}>Cancel</button>
          </div>
        </>
      )}

      {step === 'created' && link && (
        <>
          <div className={se.dlgHead}>
            <div className={se.dlgTitle}>
              <h2 className={s.h2} id={titleId}>Link created</h2>
              <span className={`${s.badge} ${se['b-active']}`}><Glyph d={GLYPH.check} />Link active</span>
            </div>
            <button type="button" className={se.closeBtn} onClick={onClose} aria-label="Close"><Glyph className={se.i} d={GLYPH.x} /></button>
          </div>
          <div className={se.dlgBody}>
            <div>
              <label className={se.label} htmlFor={linkId}>Shareable link</label>
              <div className={se.linkRow}>
                <input ref={linkRef} className={se.linkField} id={linkId} type="text" readOnly value={link.url} title={link.url} />
                <button ref={copyRef} type="button" className={`${s.secondary} ${se.copyBtn}`} data-copied={copied} onClick={copy}>
                  <Glyph className={se.i} d={copied ? GLYPH.check : GLYPH.copy} />{copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <span className={se.srOnly} aria-live="polite">{copied ? 'Link copied to the clipboard' : ''}</span>
            </div>
            <p className={se.expiryLine}><Glyph className={se.i} d={GLYPH.clock} /><span>Expires <strong>{fmt(link.expiresAt)}</strong> · {relativeToNow(link.expiresAt)}</span></p>
            <div className={se.warn}>
              <Glyph className={se.i} d={GLYPH.eye} />
              <div><strong>{COPY.warn}</strong>Revoke it here if you shared it by mistake.</div>
            </div>
            {copyError && (
              <div className={`${se.warn} ${se.err}`} role="alert"><Glyph className={se.i} d={GLYPH.alert} /><div><strong>{COPY.copyFailed}</strong></div></div>
            )}
            {error && (
              <div className={`${se.warn} ${se.err}`} role="alert"><Glyph className={se.i} d={GLYPH.alert} /><div><strong>{error}</strong></div></div>
            )}
            {confirming && (
              <div role="alertdialog" aria-label="Confirm revoke" className={s.confirm}>
                <div><strong>Revoke this link?</strong> Anyone who opens it will see that it’s no longer available. This can’t be undone.</div>
                <div className={s.confirmActions}>
                  <button type="button" className={s.inkBtn} onClick={revoke} aria-busy={busy}>{busy ? 'Revoking…' : 'Yes, revoke it'}</button>
                  <button type="button" className={s.plainBtn} onClick={() => setConfirming(false)}>Keep link</button>
                </div>
              </div>
            )}
          </div>
          <div className={se.dlgActions}>
            <button type="button" className={`${s.inkBtn} ${se.md}`} onClick={onClose}>Done</button>
            <span className={se.spacer} />
            {!confirming && (
              <button type="button" className={`${s.secondary} ${s.danger} ${se.md}`} onClick={() => setConfirming(true)}>Revoke link</button>
            )}
          </div>
        </>
      )}

      {step === 'revoked' && (
        <>
          <div className={se.dlgHead}>
            <div className={se.dlgTitle}>
              <h2 className={s.h2} id={titleId}>Link revoked</h2>
              <span className={`${s.badge} ${se['b-revoked']}`}><Glyph d={GLYPH.x} />Link revoked</span>
            </div>
            <button type="button" className={se.closeBtn} onClick={onClose} aria-label="Close"><Glyph className={se.i} d={GLYPH.x} /></button>
          </div>
          <div className={se.dlgBody}>
            <p className={se.dlgIntro}>This link no longer works. Anyone who opens it now sees that it isn’t available. You can create a new link whenever you like.</p>
          </div>
          <div className={se.dlgActions}>
            <button type="button" className={`${s.inkBtn} ${se.md}`} onClick={onClose}>Done</button>
            <span className={se.spacer} />
            <button type="button" className={`${s.plainBtn} ${se.md}`} onClick={() => { setStep('choose'); setError(null); }}>Create a new link</button>
          </div>
        </>
      )}
    </dialog>
  );
}
