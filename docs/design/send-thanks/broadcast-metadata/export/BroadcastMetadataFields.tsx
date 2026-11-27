'use client';

import { FocusEvent, KeyboardEvent, useId, useState } from 'react';
import styles from './broadcast-metadata-fields.module.css';

/** Maximum characters for preview_text. */
export const PREVIEW_TEXT_MAX = 500;

const ADDR = '[^\\s@<>",;]+@[^\\s@<>",;]+\\.[^\\s@<>",;]+';
const RE_PLAIN = new RegExp(`^${ADDR}$`);
const RE_NAMED = new RegExp(`^(?:"[^"\\r\\n]*"|[^"<>\\r\\n,;@]+)\\s*<${ADDR}>$`);

/** Returns an error message, or '' when valid. Empty is valid (the field is optional). */
export function validateReplyTo(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (/[\r\n]/.test(v)) return 'Use one line for the reply-to address.';
  if (/[,;]/.test(v)) return 'Use one reply-to address only.';
  return RE_PLAIN.test(v) || RE_NAMED.test(v)
    ? ''
    : 'Enter an email address like help@yourdomain.example, or a name and address like Help desk <help@yourdomain.example>.';
}

/** Returns an error message, or '' when valid. Empty is valid (the field is optional). */
export function validatePreviewText(value: string): string {
  if (/[\r\n]/.test(value)) return 'Remove the line breaks. Preview text is one line.';
  if (value.length > PREVIEW_TEXT_MAX) return `Shorten to ${PREVIEW_TEXT_MAX} characters or fewer.`;
  return '';
}

export type BroadcastMetadataField = 'replyTo' | 'previewText';

export interface BroadcastMetadataFieldsProps {
  /** Draft payload reply_to ('' when unset) */
  replyTo: string;
  /** Draft payload preview_text ('' when unset) */
  previewText: string;
  onReplyToChange: (value: string) => void;
  onPreviewTextChange: (value: string) => void;
  /**
   * Field errors to display. Pass this to control validation yourself (e.g. server errors).
   * When omitted, the component validates each field after it loses focus, using the exported helpers.
   */
  errors?: Partial<Record<BroadcastMetadataField, string | null | undefined>>;
  onBlur?: (field: BroadcastMetadataField) => void;
  disabled?: boolean;
  /** Placeholder for the reply-to field */
  replyToPlaceholder?: string;
  className?: string;
}

export function BroadcastMetadataFields(p: BroadcastMetadataFieldsProps) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [touched, setTouched] = useState<Record<BroadcastMetadataField, boolean>>({ replyTo: false, previewText: false });

  const replyErr = p.errors ? p.errors.replyTo || '' : touched.replyTo ? validateReplyTo(p.replyTo) : '';
  const prevErr = p.errors ? p.errors.previewText || '' : touched.previewText ? validatePreviewText(p.previewText) : '';
  const over = p.previewText.length > PREVIEW_TEXT_MAX;

  const blur = (field: BroadcastMetadataField) => (_e: FocusEvent) => { setTouched(t => ({ ...t, [field]: true })); p.onBlur?.(field); };
  const noEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter') e.preventDefault(); };

  return (
    <fieldset className={`${styles.set} ${p.className ?? ''}`} disabled={p.disabled}>
      <legend className={styles.legend}>Optional details</legend>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={id('reply')} className={styles.label}>Reply-to <span className={styles.optional}>(optional)</span></label>
          <input
            id={id('reply')} name="reply_to" type="text" inputMode="email" autoComplete="off" spellCheck={false}
            className={`${styles.control} ${replyErr ? styles.invalid : ''}`}
            value={p.replyTo} onChange={e => p.onReplyToChange(e.target.value)} onBlur={blur('replyTo')}
            placeholder={p.replyToPlaceholder ?? 'Help desk <help@yourdomain.example>'}
            aria-invalid={!!replyErr} aria-describedby={replyErr ? `${id('reply-hint')} ${id('reply-err')}` : id('reply-hint')}
          />
          <span id={id('reply-hint')} className={styles.hint}>Where replies go. Leave empty to use the From address. One address, with or without a name.</span>
          {replyErr && <span id={id('reply-err')} role="alert" className={styles.error}>{replyErr}</span>}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={id('prev')} className={styles.label}>Preview text <span className={styles.optional}>(optional)</span></label>
            <span id={id('count')} aria-live="polite" className={`${styles.count} ${over ? styles.countOver : ''}`}>{p.previewText.length} / {PREVIEW_TEXT_MAX}</span>
          </div>
          <textarea
            id={id('prev')} name="preview_text" rows={2}
            className={`${styles.control} ${styles.area} ${prevErr ? styles.invalid : ''}`}
            value={p.previewText} onChange={e => p.onPreviewTextChange(e.target.value)} onBlur={blur('previewText')} onKeyDown={noEnter}
            placeholder="A short line shown after the subject in the inbox"
            aria-invalid={!!prevErr} aria-describedby={`${id('prev-hint')} ${id('count')}${prevErr ? ' ' + id('prev-err') : ''}`}
          />
          <span id={id('prev-hint')} className={styles.hint}>One line, up to {PREVIEW_TEXT_MAX} characters. Many inboxes show only the start.</span>
          {prevErr && <span id={id('prev-err')} role="alert" className={styles.error}>{prevErr}</span>}
        </div>
      </div>
    </fieldset>
  );
}

export default BroadcastMetadataFields;
