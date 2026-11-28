import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import s from './send-thanks-api-key-bulk-revocation.module.css';

/**
 * Email, thanks: API key list with single and bulk revocation.
 * Fully controlled: the parent owns selection, step, confirm phrase and pending single revoke.
 * This component never revokes anything itself; it calls onRevokeKey / onRevokeKeys.
 */

export const BULK_REVOKE_LIMIT = 120;
export const BULK_REVOKE_PHRASE = 'REVOKE API KEYS';

export interface ApiKeyRow { id: string; name: string; prefix: string; permission: string; lastUsed: string; revoked?: boolean }
export type BulkRevokeStep = 'select' | 'confirm';

export interface SendThanksApiKeyBulkRevocationProps {
  keys: ApiKeyRow[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  step: BulkRevokeStep;
  onStepChange: (step: BulkRevokeStep) => void;
  confirmPhrase: string;
  onConfirmPhraseChange: (value: string) => void;
  /** Key id whose single-key confirm is open, or null. */
  pendingSingleId: string | null;
  onPendingSingleIdChange: (id: string | null) => void;
  /** Existing single key revoke. Omit to hide the per-row Revoke button. */
  onRevokeKey?: (id: string) => void | Promise<void>;
  /** Omit to hide checkboxes and the bulk toolbar. */
  onRevokeKeys?: (ids: string[]) => void | Promise<void>;
  /** True while a revoke request is in flight. Disables confirm buttons. */
  busy?: boolean;
  /** Plain-language message shown above the list (result or error). */
  notice?: { tone: 'info' | 'error'; text: string } | null;
  /** Clamped to 1..120. */
  limit?: number;
  title?: string;
}

const plural = (n: number) => `${n} API ${n === 1 ? 'key' : 'keys'}`;

/** First `limit` active keys, in list order. */
export function selectActiveKeyIds(keys: ApiKeyRow[], limit = BULK_REVOKE_LIMIT): { ids: string[]; leftOut: number } {
  const active = keys.filter(k => !k.revoked);
  const cap = Math.max(1, Math.min(BULK_REVOKE_LIMIT, limit));
  const ids = active.slice(0, cap).map(k => k.id);
  return { ids, leftOut: active.length - ids.length };
}

export default function SendThanksApiKeyBulkRevocation(props: SendThanksApiKeyBulkRevocationProps) {
  const { keys, selectedIds, step, confirmPhrase, pendingSingleId, busy = false, notice } = props;
  const uid = useId().replace(/:/g, '');
  const limit = Math.max(1, Math.min(BULK_REVOKE_LIMIT, props.limit ?? BULK_REVOKE_LIMIT));
  const bulkEnabled = !!props.onRevokeKeys;

  const active = keys.filter(k => !k.revoked);
  const activeIds = new Set(active.map(k => k.id));
  // Ignore stale ids (revoked or removed) so counts stay honest.
  const selected = selectedIds.filter(id => activeIds.has(id));
  const n = selected.length;
  const atLimit = n >= limit;
  const confirming = bulkEnabled && step === 'confirm' && n > 0;
  const matches = confirmPhrase === BULK_REVOKE_PHRASE;
  const leftOut = Math.max(0, active.length - limit);
  const selectedNames = keys.filter(k => selected.includes(k.id)).map(k => k.name);

  const bulkBtn = useRef<HTMLButtonElement>(null);
  const phraseInput = useRef<HTMLInputElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current !== step) {
      if (step === 'confirm') phraseInput.current?.focus();
      else bulkBtn.current?.focus();
      prevStep.current = step;
    }
  }, [step]);

  useEffect(() => {
    if (pendingSingleId) document.getElementById(`${uid}-sc-${pendingSingleId}`)?.focus();
  }, [pendingSingleId, uid]);

  const toggle = (id: string, on: boolean) => {
    if (on && (atLimit || selected.includes(id))) return;
    props.onSelectedIdsChange(on ? [...selected, id] : selected.filter(x => x !== id));
    if (confirmPhrase) props.onConfirmPhraseChange('');
  };

  const cancelBulk = () => { props.onConfirmPhraseChange(''); props.onStepChange('select'); };
  const runBulk = async () => {
    if (!matches || busy || !props.onRevokeKeys) return;
    await props.onRevokeKeys(selected);
  };
  const closeSingle = (id: string) => {
    props.onPendingSingleIdChange(null);
    requestAnimationFrame(() => document.getElementById(`${uid}-rv-${id}`)?.focus());
  };
  const escape = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fn(); } };

  const countText = n === 0 ? `No keys selected · limit ${limit}` : atLimit ? `${n} selected · limit of ${limit} reached` : `${n} of ${limit} selected`;

  return (
    <section className={s.card} aria-labelledby={`${uid}-title`}>
      <div className={s.head}>
        <div className={s.titleRow}>
          <h2 id={`${uid}-title`} className={s.h2}>{props.title ?? 'Your keys'}</h2>
          <span className={s.mono}>{active.length} ACTIVE · {keys.length - active.length} REVOKED</span>
        </div>
        {bulkEnabled && !confirming && (
          <div className={s.toolbar} role="group" aria-label="Select API keys to revoke together">
            <button type="button" className={s.btn} disabled={active.length === 0}
              onClick={() => { props.onSelectedIdsChange(selectActiveKeyIds(keys, limit).ids); props.onPendingSingleIdChange(null); }}>
              Select active keys
            </button>
            <button type="button" className={s.btn} disabled={n === 0} onClick={() => props.onSelectedIdsChange([])}>Clear selection</button>
            <span className={s.count} aria-live="polite">{countText}</span>
            <button ref={bulkBtn} type="button" className={s.bulkBtn} disabled={n === 0}
              onClick={() => { props.onPendingSingleIdChange(null); props.onConfirmPhraseChange(''); props.onStepChange('confirm'); }}>
              {n === 0 ? 'Revoke selected keys' : `Revoke ${plural(n)}`}
            </button>
          </div>
        )}
      </div>

      {notice && <div className={notice.tone === 'error' ? `${s.notice} ${s.noticeError}` : s.notice} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {bulkEnabled && !confirming && atLimit && leftOut > 0 && (
        <p className={s.limitNote}>You can revoke up to {limit} keys at once. {leftOut} active {leftOut === 1 ? 'key is' : 'keys are'} not selected.</p>
      )}

      {confirming && (
        <div className={s.confirm} role="alertdialog" aria-labelledby={`${uid}-ct`} aria-describedby={`${uid}-cd`} onKeyDown={escape(cancelBulk)}>
          <h3 id={`${uid}-ct`} className={s.h3}>Revoke {plural(n)}?</h3>
          <div id={`${uid}-cd`} className={s.confirmCopy}>
            <p><strong>They stop working immediately.</strong> Any website, app or script using them will fail to send email until you give it a new key.</p>
            <p><strong>Revoked keys cannot be restored.</strong> To send again, create a new key and update everything that used the old one.</p>
          </div>
          <div className={s.preview}>
            <span className={s.mono}>KEYS TO REVOKE</span>
            <ul className={s.previewList}>{selectedNames.slice(0, 5).map(name => <li key={name}>{name}</li>)}</ul>
            {selectedNames.length > 5 && <span className={s.previewMore}>and {selectedNames.length - 5} more</span>}
          </div>
          <label htmlFor={`${uid}-phrase`} className={s.phraseLabel}>
            <span className={s.phraseTitle}>Type {BULK_REVOKE_PHRASE} to confirm</span>
            <span id={`${uid}-ph`} className={s.hint}>Use capitals, exactly as shown.</span>
          </label>
          <input ref={phraseInput} id={`${uid}-phrase`} className={s.phraseInput} aria-describedby={`${uid}-ph`}
            value={confirmPhrase} onChange={e => props.onConfirmPhraseChange(e.target.value)}
            autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <span className={s.matchText} aria-live="polite">
            {matches ? 'Phrase matches. You can revoke now.' : confirmPhrase ? 'Phrase does not match yet.' : 'Revoke stays off until the phrase matches.'}
          </span>
          <div className={s.actions}>
            <button type="button" className={s.inkBtn} disabled={!matches || busy} onClick={runBulk}>{busy ? 'Revoking…' : `Revoke ${plural(n)}`}</button>
            <button type="button" className={s.btn} disabled={busy} onClick={cancelBulk}>Keep keys</button>
          </div>
          <span className={s.hint}>Press Escape to go back without revoking.</span>
        </div>
      )}

      {keys.length === 0 ? <p className={s.empty}>No API keys yet.</p> : (
        <ul className={s.list} aria-label="API keys">
          {keys.map(k => {
            const checked = selected.includes(k.id);
            const stateWord = k.revoked ? 'Revoked' : checked ? 'Selected' : 'Active';
            const rowCls = [s.row, checked ? s.rowSelected : '', k.revoked ? s.rowRevoked : ''].filter(Boolean).join(' ');
            return (
              <li key={k.id} className={rowCls}>
                <div className={s.rowLine}>
                  {bulkEnabled && (k.revoked ? <span className={s.boxSpacer} aria-hidden="true" /> : (
                    <label className={s.boxTarget} htmlFor={`${uid}-box-${k.id}`}>
                      <input id={`${uid}-box-${k.id}`} type="checkbox" className={s.box} checked={checked}
                        disabled={confirming || (!checked && atLimit)} onChange={e => toggle(k.id, e.target.checked)}
                        aria-label={`Select ${k.name} to revoke`} />
                    </label>
                  ))}
                  <div className={s.rowText}>
                    <span className={s.name}>{k.name}</span>
                    <span className={s.meta}>{k.prefix} · {k.permission} · Last used {k.lastUsed}</span>
                  </div>
                  <span className={`${s.state} ${k.revoked ? s.stateRevoked : checked ? s.stateSelected : ''}`}>{stateWord}</span>
                  {!k.revoked && props.onRevokeKey && !confirming && pendingSingleId !== k.id && (
                    <button id={`${uid}-rv-${k.id}`} type="button" className={`${s.btn} ${s.danger}`} aria-label={`Revoke ${k.name}`}
                      onClick={() => props.onPendingSingleIdChange(k.id)}>Revoke</button>
                  )}
                </div>
                {!k.revoked && pendingSingleId === k.id && !confirming && (
                  <div className={s.single} role="alertdialog" aria-labelledby={`${uid}-st-${k.id}`} onKeyDown={escape(() => closeSingle(k.id))}>
                    <p className={s.singleCopy}><strong id={`${uid}-st-${k.id}`}>Revoke “{k.name}”?</strong> Anything using this key will stop sending straight away. This can't be undone.</p>
                    <div className={s.actions}>
                      <button id={`${uid}-sc-${k.id}`} type="button" className={s.inkBtn} disabled={busy}
                        onClick={async () => { await props.onRevokeKey?.(k.id); }}>{busy ? 'Revoking…' : 'Revoke key'}</button>
                      <button type="button" className={s.btn} disabled={busy} onClick={() => closeSingle(k.id)}>Keep key</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
