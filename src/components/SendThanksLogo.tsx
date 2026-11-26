import type { CSSProperties } from 'react';

type Surface = 'paper' | 'ink';

const C = { tomato: '#FF5A36', ink: '#1C1916', chalk: '#FBF9F5' };

/** The comma, alone. Same geometry as /comma-icon.svg. */
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
          <circle cx="32" cy="26" r="10" fill={mark} />
          <path d="M42 26C42 37 36.5 44.5 26.5 49L24 45C29.5 42.2 32.5 38.5 33.3 34.9Z" fill={mark} />
        </>
      ) : (
        <>
          <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill={tile} stroke={stroke} strokeWidth="3" />
          <circle cx="32" cy="26" r="9" fill={mark} />
          <path d="M41 26C41 36 36 43.5 27 48L25 44.6C30 42 32.6 38.5 33.3 34.9Z" fill={mark} />
        </>
      )}
    </svg>
  );
}

/** Wordmark: Schibsted Grotesk 800, -0.035em. Only the comma is tomato. */
export function SendThanksLogo({
  size = 21,
  surface = 'paper',
  withIcon = false,
  style,
}: { size?: number; surface?: Surface; withIcon?: boolean; style?: CSSProperties }) {
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
      {withIcon && <CommaIcon size={Math.round(size * 1.7)} surface={surface} />}
      <span>
        Send<span style={{ color: C.tomato }}>,</span> thanks
      </span>
    </span>
  );
}

export default SendThanksLogo;
