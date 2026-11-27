// Inline stroke icons on the Send, thanks 24px grid. No icon font, no emoji.
import type { SVGProps } from 'react';

const PATHS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  emails: 'M3 6h18v12H3zM3 7l9 6 9-6',
  templates: 'M4 4h16v16H4zM4 10h16M10 10v10',
  domains: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  blocklist: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  apikeys: 'M15 3a6 6 0 1 1-5.2 9L3 18.8V21h3v-2h2v-2h2l1.8-1.8A6 6 0 0 1 15 3zM16.5 7.5h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  text: 'M5 6h14M12 6v13M9 19h6',
  heading: 'M4 5v14M12 5v14M4 12h8M17 9l2-1v11',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M16 9h.01',
  button: 'M3 8h18v8H3zM8 12h8',
  divider: 'M4 12h16M12 5v3M12 16v3',
  table: 'M3 4h18v16H3zM3 10h18M9 4v16M15 4v16',
  spacer: 'M4 4h16M4 20h16M12 8v8M9 11l3-3 3 3M9 13l3 3 3-3',
  columns2: 'M4 4h7v16H4zM13 4h7v16h-7z',
  columns3: 'M3 4h5v16H3zM9.5 4h5v16h-5zM16 4h5v16h-5z',
  visual: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  code: 'M8 7l-4 5 4 5M16 7l4 5-4 5M14 4l-4 16',
  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  phone: 'M7 3h10v18H7zM11 18h2',
  braces: 'M9 4H8a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M15 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  back: 'M19 12H7M12 6l-6 6 6 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  blocks: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alignLeft: 'M4 6h16M4 12h10M4 18h14',
  alignCenter: 'M4 6h16M7 12h10M5 18h14',
  alignRight: 'M4 6h16M10 12h10M6 18h14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Send, thanks mark: tomato tile, chalk comma. Pair it with the wordmark text. */
export function SendThanksMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" {...props}>
      <rect x="1.5" y="1.5" width="61" height="61" rx="16" fill="#FF5A36" stroke="#1C1916" strokeWidth="3" />
      <circle cx="32" cy="23" r="9" fill="#FBF9F5" />
      <path d="M41 35.5C41 43 34 49 21 52C27 48 31 43.5 32.5 38.5Z" fill="#FBF9F5" />
    </svg>
  );
}
