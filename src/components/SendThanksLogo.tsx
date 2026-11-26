import type { CSSProperties } from 'react';

type Surface = 'paper' | 'ink';

const C = { tomato: '#FF5A36', ink: '#1C1916', chalk: '#FBF9F5' };

/** The comma, alone. Same glyph as /comma-icon.svg and /favicon.svg: a round dot, then a separate tapered tail below it that sweeps down-left. There is a clear tomato gap between them (≥5.8 of 64 units, ≈2.9px at 32px); the two shapes never touch. */
export function CommaIcon({
  size = 36,
  surface = 'paper',
  favicon = false,
  title,
}: { size?: number; surface?: Surface; favicon?: boolean; title?: string }) {
  const tile = surface === 'ink' ? C.ink : C.tomato;
  const mark = surface === 'ink' ? C.tomato : C.chalk;
  const stroke = surface === 'ink' ? C.chalk : C.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {favicon ? (
        <>
          <rect width="64" height="64" rx="14" fill={tile} />
          <circle cx="32" cy="23" r="9" fill={mark} />
          <path d="M41 35.5C41 43 34 49 21 52C27 48 31 43.5 32.5 38.5Z" fill={mark} />
        </>
      ) : (
        <>
          <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill={tile} stroke={stroke} strokeWidth="3" />
          <circle cx="32" cy="23" r="9" fill={mark} />
          <path d="M41 35.5C41 43 34 49 21 52C27 48 31 43.5 32.5 38.5Z" fill={mark} />
        </>
      )}
    </svg>
  );
}

/** Use this in BOTH the desktop sidebar and phone top bar so the comma icon is identical (same SVG, 32px).
 *  Wordmark: Schibsted Grotesk 800, -0.035em. Only the comma is tomato. */
export function SendThanksLogo({
  size = 21,
  surface = 'paper',
  withIcon = false,
  iconSize = 32,
  style,
}: { size?: number; surface?: Surface; withIcon?: boolean; iconSize?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.48,
        fontFamily: "'Schibsted Grotesk', sans-serif",
        fontWeight: 800,
        fontSize: size,
        letterSpacing: '-0.035em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: surface === 'ink' ? C.chalk : C.ink,
        ...style,
      }}
    >
      {withIcon && <CommaIcon size={iconSize} surface={surface} />}
      <span>
        Send<span style={{ color: C.tomato }}>,</span> thanks
      </span>
    </span>
  );
}

export default SendThanksLogo;
