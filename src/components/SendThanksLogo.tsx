import type { CSSProperties } from 'react';

/* Email, thanks brand: logo 1a "Tomato comma". Bold Schibsted Grotesk wordmark, the comma alone in tomato,
   and a comma-only icon: a round dot plus a separate tapered tail on a tomato tile with an ink outline. */

export const SEND_THANKS_TOMATO = '#FF5A36';
export const SEND_THANKS_INK = '#1C1916';
export const SEND_THANKS_CHALK = '#FBF9F5';
const DOT = { cx: 32, cy: 23, r: 9 };
const TAIL = 'M41 35.5C41 43 34 49 21 52C27 48 31 43.5 32.5 38.5Z';

export interface CommaIconProps {
  size?: number;
  /** true = ink-outlined tile (app icon); false = flat tile (favicon) */
  outlined?: boolean;
  title?: string;
  className?: string;
}

export function CommaIcon({ size = 32, outlined = true, title, className }: CommaIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {outlined
        ? <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill={SEND_THANKS_TOMATO} stroke={SEND_THANKS_INK} strokeWidth="3" />
        : <rect width="64" height="64" rx="14" fill={SEND_THANKS_TOMATO} />}
      <circle cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill={SEND_THANKS_CHALK} />
      <path d={TAIL} fill={SEND_THANKS_CHALK} />
    </svg>
  );
}

export interface SendThanksLogoProps {
  /** Wordmark font size in px */
  size?: number;
  withIcon?: boolean;
  iconSize?: number;
  /** 'ink' on paper/chalk, 'chalk' on ink backgrounds */
  tone?: 'ink' | 'chalk';
  className?: string;
}

export function SendThanksLogo({ size = 21, withIcon = false, iconSize = 32, tone = 'ink', className }: SendThanksLogoProps) {
  const wrap: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.45) };
  const word: CSSProperties = {
    fontFamily: "'Schibsted Grotesk', system-ui, sans-serif", fontWeight: 800, fontSize: size, lineHeight: 1,
    letterSpacing: '-0.035em', whiteSpace: 'nowrap', color: tone === 'ink' ? SEND_THANKS_INK : SEND_THANKS_CHALK,
  };
  return (
    <span className={className} style={wrap} role="img" aria-label="Email, thanks">
      {withIcon && <CommaIcon size={iconSize} />}
      <span style={word} aria-hidden="true">Email<span style={{ color: SEND_THANKS_TOMATO }}>,</span> thanks</span>
    </span>
  );
}

export default SendThanksLogo;
