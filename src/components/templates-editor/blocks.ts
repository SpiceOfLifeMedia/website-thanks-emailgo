// Send, thanks · Templates editor — data model, tokens and the demo template.
// No runtime dependencies.

export type BlockKind =
  | 'image'
  | 'heading'
  | 'text'
  | 'button'
  | 'spacer'
  | 'divider'
  | 'columns2'
  | 'columns3';

export type Align = 'left' | 'center' | 'right';

export interface TextStyle {
  fontSize: number;
  align: Align;
  color: string;
  spaceAbove: number;
  spaceBelow: number;
}

export interface Block {
  id: string;
  kind: BlockKind;
  /** Text, heading, button label, image alt, or empty. May contain {{variables}}. */
  content: string;
  /** Image blocks only. Empty string renders a labelled placeholder. */
  src?: string;
  /** Preserved while editing image details in the canvas. */
  imageHref?: string;
  /** Button blocks only. */
  href?: string;
  /** Spacer blocks only (px). */
  height?: number;
  /** Text and heading blocks only. */
  style?: TextStyle;
}

export type EmailFont = 'sans' | 'georgia' | 'arial';

export interface EmailTheme {
  background: string;
  button: string;
  font: EmailFont;
}

export const TOKENS = {
  paper: '#F4EEE3',
  chalk: '#FBF9F5',
  ink: '#1C1916',
  graphite: '#3D3832',
  tomato: '#FF5A36',
  honey: '#F7D56E',
  basil: '#2E6B4B',
  line: '#E3DCD0',
  pencil: '#6B6359',
} as const;

export const FONT_STACKS: Record<EmailFont, string> = {
  sans: 'Schibsted Grotesk, sans-serif',
  georgia: 'Georgia, serif',
  arial: 'Arial, sans-serif',
};

export const FONT_LABELS: Record<EmailFont, string> = {
  sans: 'Schibsted Grotesk',
  georgia: 'Georgia',
  arial: 'Arial',
};

export const TEXT_COLOURS = [
  { name: 'Ink', value: TOKENS.ink },
  { name: 'Graphite', value: TOKENS.graphite },
  { name: 'Pencil', value: TOKENS.pencil },
  { name: 'Tomato', value: TOKENS.tomato },
  { name: 'Basil', value: TOKENS.basil },
] as const;

export const BACKGROUNDS = [
  { name: 'Chalk', value: TOKENS.chalk },
  { name: 'Paper', value: TOKENS.paper },
  { name: 'White', value: '#FFFFFF' },
] as const;

export const BUTTON_COLOURS = [
  { name: 'Tomato', value: TOKENS.tomato },
  { name: 'Ink', value: TOKENS.ink },
  { name: 'Basil', value: TOKENS.basil },
] as const;

export const VARIABLES = [
  'first_name',
  'last_name',
  'email',
  'shop_name',
  'order_number',
  'unsubscribe_link',
] as const;

export const BLOCK_LABELS: Record<BlockKind, string> = {
  image: 'Image',
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  spacer: 'Spacer',
  divider: 'Divider',
  columns2: '2 columns',
  columns3: '3 columns',
};

export const TRAY: BlockKind[] = [
  'text',
  'heading',
  'image',
  'button',
  'divider',
  'spacer',
  'columns2',
  'columns3',
];

export const DEFAULT_THEME: EmailTheme = {
  background: TOKENS.chalk,
  button: TOKENS.tomato,
  font: 'sans',
};

const textStyle = (over: Partial<TextStyle> = {}): TextStyle => ({
  fontSize: 16,
  align: 'left',
  color: TOKENS.graphite,
  spaceAbove: 12,
  spaceBelow: 12,
  ...over,
});

let seq = 0;
export const newId = (kind: BlockKind) => `${kind}-${++seq}-${Date.now().toString(36)}`;

export function makeBlock(kind: BlockKind): Block {
  const id = newId(kind);
  switch (kind) {
    case 'text':
      return { id, kind, content: 'Write something…', style: textStyle() };
    case 'heading':
      return { id, kind, content: 'New heading', style: textStyle({ fontSize: 28, color: TOKENS.ink }) };
    case 'image':
      return { id, kind, content: 'Describe the image', src: '' };
    case 'button':
      return { id, kind, content: 'Call to action →', href: 'https://example.com' };
    case 'spacer':
      return { id, kind, content: '', height: 24 };
    case 'divider':
      return { id, kind, content: '' };
    case 'columns2':
    case 'columns3':
      return { id, kind, content: '' };
  }
}

/** The demo welcome email for the fictional Good Yarn Co. */
export const welcomeEmail: Block[] = [
  { id: 'logo', kind: 'image', content: 'Good Yarn Co.', src: '' },
  {
    id: 'heading',
    kind: 'heading',
    content: 'Glad you’re here, {{first_name}}.',
    style: textStyle({ fontSize: 28, color: TOKENS.ink }),
  },
  {
    id: 'text',
    kind: 'text',
    content:
      'Thanks for joining Good Yarn Co. Every skein we send is wound by hand in our little shop in Adelaide, and your first order ships free. Have a look at what’s new this season.',
    style: textStyle(),
  },
  { id: 'button', kind: 'button', content: 'Browse the new season →', href: 'https://goodyarn.com.au/new' },
  { id: 'spacer', kind: 'spacer', content: '', height: 24 },
  { id: 'divider', kind: 'divider', content: '' },
  {
    id: 'footer',
    kind: 'text',
    content:
      'Good Yarn Co. · 14 Market Lane, Adelaide SA 5000\nYou’re getting this because you made an account with us. {{unsubscribe_link}}',
    style: textStyle({ fontSize: 12, color: TOKENS.pencil, spaceAbove: 0, spaceBelow: 0 }),
  },
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Table-based HTML for the Code view and for sending. Variables stay as {{name}}. */
export function toEmailHtml(blocks: Block[], theme: EmailTheme, width = 600): string {
  const font = FONT_STACKS[theme.font];
  const dark = theme.button === TOKENS.ink || theme.button === TOKENS.basil;
  const rows = blocks.map((b) => {
    const st = b.style;
    const text = st
      ? `font-size:${st.fontSize}px;text-align:${st.align};color:${st.color};padding:${st.spaceAbove}px 0 ${st.spaceBelow}px`
      : '';
    switch (b.kind) {
      case 'image':
        return `<tr><td><img src="${esc(b.src || '')}" alt="${esc(b.content)}" width="200" style="display:block"></td></tr>`;
      case 'heading':
        return `<tr><td style="font-weight:800;line-height:1.15;${text}">${esc(b.content)}</td></tr>`;
      case 'text':
        return `<tr><td style="line-height:1.6;${text}">${esc(b.content).replace(/\n/g, '<br>')}</td></tr>`;
      case 'button':
        return `<tr><td><a href="${esc(b.href || '#')}" style="display:inline-block;padding:14px 22px;border:2px solid ${TOKENS.ink};border-radius:12px;background:${theme.button};color:${dark ? TOKENS.chalk : TOKENS.ink};font-weight:800;text-decoration:none">${esc(b.content)}</a></td></tr>`;
      case 'spacer':
        return `<tr><td height="${b.height ?? 24}" style="font-size:0;line-height:0">&nbsp;</td></tr>`;
      case 'divider':
        return `<tr><td style="border-top:2px solid ${TOKENS.line};font-size:0">&nbsp;</td></tr>`;
      case 'columns2':
      case 'columns3': {
        const n = b.kind === 'columns2' ? 2 : 3;
        const cells = Array.from({ length: n }, () => `<td width="${Math.floor(100 / n)}%" valign="top"></td>`).join('');
        return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
      }
    }
  });
  return [
    `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="background:${theme.background};font-family:${font};color:${TOKENS.ink}">`,
    ...rows.map((r) => `  ${r}`),
    '</table>',
  ].join('\n');
}
