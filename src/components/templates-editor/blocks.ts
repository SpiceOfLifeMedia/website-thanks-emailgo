// Send, thanks · Templates editor — data model, tokens and the demo template.
// No runtime dependencies.

export type BlockKind =
  | 'image'
  | 'heading'
  | 'text'
  | 'button'
  | 'spacer'
  | 'divider'
  | 'table'
  | 'columns2'
  | 'columns3';

export type Align = 'left' | 'center' | 'right';
export type TableBorderMode = 'all' | 'horizontal' | 'none';
export type TableCell =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; alt: string };

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
  /** Table blocks only. Text cells support template variables; image URLs are checked on save. */
  rows?: TableCell[][];
  headerRow?: boolean;
  headerColumn?: boolean;
  alignments?: Align[];
  borderMode?: TableBorderMode;
  stripedRows?: boolean;
  borderColor?: string;
  cellBackground?: string;
  cellPadding?: number;
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
  table: 'Table',
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
  'table',
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
    case 'table':
      return {
        id,
        kind,
        content: '',
        rows: [
          ['Item', 'Quantity', 'Total'].map((text) => ({ type: 'text' as const, text })),
          ['Good yarn', '2 skeins', '$24'].map((text) => ({ type: 'text' as const, text })),
          ['Delivery', 'Standard', '$5'].map((text) => ({ type: 'text' as const, text })),
        ],
        headerRow: true,
        headerColumn: false,
        alignments: ['left', 'center', 'right'],
        borderMode: 'all',
        stripedRows: false,
        borderColor: TOKENS.line,
        cellBackground: '#FFFFFF',
        cellPadding: 8,
      };
    case 'columns2':
    case 'columns3':
      return { id, kind, content: '' };
  }
}

function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '\\' && (next === '|' || next === '\\')) {
      cell += next;
      index += 1;
      continue;
    }
    if (character === '`') {
      inCode = !inCode;
      cell += character;
      continue;
    }
    if (character === '|' && !inCode) {
      if (cells.length === 0 && !cell.trim()) {
        cell = '';
        continue;
      }
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  if (cell.trim() || !line.trimEnd().endsWith('|')) cells.push(cell.trim());
  return cells;
}

function markdownTableCell(value: string): TableCell | null {
  const image = /^!\[([^\]]*)\]\((.*)\)$/.exec(value);
  if (!image) return value.length <= 200 ? { type: 'text', text: value } : null;
  const [, alt, src] = image;
  if (!alt.trim() || alt.length > 125 || src.length > 2_000 || /[\u0000-\u0020"'<>]/.test(src)) return null;
  try {
    const url = new URL(src);
    if (url.protocol !== 'https:' || !url.hostname) return null;
  } catch { return null; }
  return { type: 'image', src, alt };
}

/** Convert a pasted Markdown table into the editor's bounded table block. */
export function parseMarkdownTable(markdown: string): Block | null {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3 || !lines[0].includes('|')) return null;
  const headers = splitMarkdownTableRow(lines[0]);
  const separators = splitMarkdownTableRow(lines[1]);
  if (headers.length < 1 || headers.length > 4 || separators.length !== headers.length) return null;
  const separatorPattern = /^:?-{3,}:?$/;
  if (!separators.every((cell) => separatorPattern.test(cell.replace(/\s/g, '')))) return null;

  const alignments: Align[] = separators.map((cell) => {
    const compact = cell.replace(/\s/g, '');
    if (compact.startsWith(':') && compact.endsWith(':')) return 'center';
    if (compact.endsWith(':')) return 'right';
    return 'left';
  });
  const rawRows = [headers, ...lines.slice(2).map(splitMarkdownTableRow)];
  if (rawRows.length > 8 || rawRows.some((row) => row.length !== headers.length)) return null;
  const rows = rawRows.map((row) => row.map(markdownTableCell));
  if (rows.some((row) => row.some((cell) => cell === null))) return null;
  return {
    id: newId('table'),
    kind: 'table',
    content: '',
    rows: rows as TableCell[][],
    headerRow: true,
    headerColumn: false,
    alignments,
    borderMode: 'all',
    stripedRows: false,
    borderColor: TOKENS.line,
    cellBackground: '#FFFFFF',
    cellPadding: 8,
  };
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
      case 'table': {
        const tableRows = b.rows ?? [];
        const borderMode = b.borderMode ?? 'all';
        const borderColor = b.borderColor ?? TOKENS.line;
        const columnWidth = tableRows[0]?.length ? `${Math.floor(100 / tableRows[0].length)}%` : '100%';
        const renderTableRow = (row: TableCell[], rowIndex: number) => {
          const isHeaderRow = Boolean(b.headerRow && rowIndex === 0);
          const striped = Boolean(b.stripedRows && !isHeaderRow && (rowIndex - Number(Boolean(b.headerRow))) % 2 === 1);
          const cellsHtml = row.map((cell, columnIndex) => {
            const isHeaderColumn = Boolean(b.headerColumn && columnIndex === 0 && !isHeaderRow);
            const isHeader = isHeaderRow || isHeaderColumn;
            const tag = isHeader ? 'th' : 'td';
            const scope = isHeaderRow ? 'col' : isHeaderColumn ? 'row' : undefined;
            const alignment = b.alignments?.[columnIndex] ?? 'left';
            const background = isHeader ? TOKENS.honey : striped ? TOKENS.paper : (b.cellBackground ?? '#FFFFFF');
            const cellBorder = borderMode === 'all'
              ? `border:1px solid ${borderColor};`
              : borderMode === 'horizontal'
                ? `border-bottom:1px solid ${borderColor};`
                : 'border:0;';
            const content = cell.type === 'image'
              ? `<img src="${esc(cell.src)}" alt="${esc(cell.alt)}" width="${Math.floor((width - 40) / Math.max(row.length, 1))}" style="display:block;width:100%;max-width:${Math.floor((width - 40) / Math.max(row.length, 1))}px;height:auto;border:0">`
              : esc(cell.text);
            return `<${tag}${scope ? ` scope="${scope}"` : ''} width="${columnWidth}" align="${alignment}" bgcolor="${background}" style="width:${columnWidth};${cellBorder}padding:${b.cellPadding ?? 8}px;text-align:${alignment};vertical-align:top;background-color:${background};font-weight:${isHeader ? 700 : 400};word-break:break-word;">${content}</${tag}>`;
          }).join('');
          return `<tr>${cellsHtml}</tr>`;
        };
        const header = b.headerRow && tableRows.length ? `<thead>${renderTableRow(tableRows[0], 0)}</thead>` : '';
        const bodyRows = tableRows.slice(b.headerRow ? 1 : 0).map((row, index) => renderTableRow(row, index + Number(Boolean(b.headerRow)))).join('');
        const body = `<tbody>${bodyRows}</tbody>`;
        return `<tr><td style="padding:8px 20px;"><table role="table" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:${font};">${header}${body}</table></td></tr>`;
      }
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
