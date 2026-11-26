export type EmailDesignAlignment = 'left' | 'center' | 'right';

export type EmailDesignTextBlock = {
  id: string;
  type: 'text';
  content: string;
  alignment: EmailDesignAlignment;
  fontSize: number;
  color?: string;
  spaceAbove?: number;
  spaceBelow?: number;
};

export type EmailDesignHeadingBlock = {
  id: string;
  type: 'heading';
  content: string;
  alignment: EmailDesignAlignment;
  fontSize: number;
  color?: string;
  spaceAbove?: number;
  spaceBelow?: number;
};

export type EmailDesignImageBlock = {
  id: string;
  type: 'image';
  src: string;
  alt: string;
  href: string | null;
};

export type EmailDesignButtonBlock = {
  id: string;
  type: 'button';
  label: string;
  href: string;
  alignment: EmailDesignAlignment;
};

export type EmailDesignDividerBlock = { id: string; type: 'divider' };
export type EmailDesignSpacerBlock = { id: string; type: 'spacer'; height: number };
export type EmailDesignColumnsBlock = { id: string; type: 'columns'; columns: EmailDesignBlock[][] };

export type EmailDesignBlock = EmailDesignTextBlock | EmailDesignHeadingBlock | EmailDesignImageBlock | EmailDesignButtonBlock | EmailDesignDividerBlock | EmailDesignSpacerBlock | EmailDesignColumnsBlock;

export type EmailDesign = {
  version: 1;
  theme: {
    background: string;
    contentBackground: string;
    textColor: string;
    accentColor: string;
    contentWidth: number;
    font: 'sans' | 'georgia' | 'arial';
  };
  blocks: EmailDesignBlock[];
};

const DEFAULT_THEME: EmailDesign['theme'] = {
  background: '#F4EEE3',
  contentBackground: '#FBF9F5',
  textColor: '#1C1916',
  accentColor: '#FF5A36',
  contentWidth: 600,
  font: 'sans',
};

const ALIGNMENTS = new Set<EmailDesignAlignment>(['left', 'center', 'right']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const TEMPLATE_VARIABLE = /\{\{\{\s*[A-Za-z_][A-Za-z0-9_.-]{0,99}\s*\}\}\}|\{\{\s*[A-Za-z_][A-Za-z0-9_.-]{0,99}\s*\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown, field: string, maxLength: number): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) return { ok: false, error: `${field} must be text of at most ${maxLength} characters.` };
  return { ok: true, value };
}

function safeAlignment(value: unknown): value is EmailDesignAlignment {
  return typeof value === 'string' && ALIGNMENTS.has(value as EmailDesignAlignment);
}

function safeColor(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) return { ok: false, error: `${field} must be a six digit hex color.` };
  return { ok: true, value: value.toUpperCase() };
}

function safeLink(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.length > 2_000 || /[\u0000-\u0020"'<>]/.test(value)) return { ok: false, error: `${field} must be a valid web or email link.` };
  if (/^\{\{\{?[A-Za-z_][A-Za-z0-9_.-]{0,99}\}\}?\}$/.test(value)) return { ok: true, value };
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return { ok: false, error: `${field} must use HTTPS, HTTP, or email.` };
    return { ok: true, value };
  } catch { return { ok: false, error: `${field} must be a valid web or email link.` }; }
}

function validateBlock(value: unknown, path: string, seenIds: Set<string>, nested = false): { ok: true; block: EmailDesignBlock } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: `${path} must be a block object.` };
  const { id, type } = value;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || seenIds.has(id)) return { ok: false, error: `${path}.id must be unique, with 1 to 80 letters, numbers, underscores, or hyphens.` };
  seenIds.add(id);

  if (type === 'text' || type === 'heading') {
    const content = safeText(value.content, `${path}.content`, 10_000);
    if (!content.ok) return content;
    if (!safeAlignment(value.alignment)) return { ok: false, error: `${path}.alignment must be left, center, or right.` };
    const fontSize = value.fontSize;
    if (typeof fontSize !== 'number' || !Number.isInteger(fontSize) || fontSize < (type === 'heading' ? 20 : 12) || fontSize > 48) return { ok: false, error: `${path}.fontSize is outside the supported range.` };
    const color = value.color === undefined ? undefined : safeColor(value.color, `${path}.color`);
    if (color && !color.ok) return color;
    const spaceAbove = value.spaceAbove === undefined ? undefined : value.spaceAbove;
    const spaceBelow = value.spaceBelow === undefined ? undefined : value.spaceBelow;
    if (spaceAbove !== undefined && (typeof spaceAbove !== 'number' || !Number.isInteger(spaceAbove) || spaceAbove < 0 || spaceAbove > 48)) return { ok: false, error: `${path}.spaceAbove must be between 0 and 48 pixels.` };
    if (spaceBelow !== undefined && (typeof spaceBelow !== 'number' || !Number.isInteger(spaceBelow) || spaceBelow < 0 || spaceBelow > 48)) return { ok: false, error: `${path}.spaceBelow must be between 0 and 48 pixels.` };
    return { ok: true, block: { id, type, content: content.value, alignment: value.alignment, fontSize, ...(color ? { color: color.value } : {}), ...(spaceAbove === undefined ? {} : { spaceAbove }), ...(spaceBelow === undefined ? {} : { spaceBelow }) } };
  }

  if (type === 'image') {
    const src = safeText(value.src, `${path}.src`, 2_000);
    const alt = safeText(value.alt, `${path}.alt`, 500);
    if (!src.ok) return src;
    if (!alt.ok) return alt;
    if (src.value) {
      let parsed: URL;
      try { parsed = new URL(src.value); } catch { return { ok: false, error: `${path}.src must be an HTTPS image URL.` }; }
      if (parsed.protocol !== 'https:') return { ok: false, error: `${path}.src must be an HTTPS image URL.` };
    }
    let href: string | null = null;
    if (value.href !== undefined && value.href !== null && value.href !== '') {
      const result = safeLink(value.href, `${path}.href`);
      if (!result.ok) return result;
      href = result.value;
    }
    return { ok: true, block: { id, type, src: src.value, alt: alt.value, href } };
  }

  if (type === 'button') {
    const label = safeText(value.label, `${path}.label`, 500);
    const href = safeLink(value.href, `${path}.href`);
    if (!label.ok) return label;
    if (!href.ok) return href;
    if (!label.value.trim()) return { ok: false, error: `${path}.label cannot be empty.` };
    if (!safeAlignment(value.alignment)) return { ok: false, error: `${path}.alignment must be left, center, or right.` };
    return { ok: true, block: { id, type, label: label.value, href: href.value, alignment: value.alignment } };
  }

  if (type === 'divider') return { ok: true, block: { id, type } };

  if (type === 'spacer') {
    const height = value.height;
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 4 || height > 160) return { ok: false, error: `${path}.height must be between 4 and 160 pixels.` };
    return { ok: true, block: { id, type, height } };
  }

  if (type === 'columns') {
    if (nested) return { ok: false, error: `${path} cannot contain nested columns.` };
    if (!Array.isArray(value.columns) || value.columns.length < 2 || value.columns.length > 3) return { ok: false, error: `${path}.columns must contain two or three columns.` };
    const columns: EmailDesignBlock[][] = [];
    for (const [columnIndex, column] of value.columns.entries()) {
      if (!Array.isArray(column) || column.length > 8) return { ok: false, error: `${path}.columns[${columnIndex}] must contain at most eight blocks.` };
      const blocks: EmailDesignBlock[] = [];
      for (const [blockIndex, child] of column.entries()) {
        const result = validateBlock(child, `${path}.columns[${columnIndex}][${blockIndex}]`, seenIds, true);
        if (!result.ok) return result;
        blocks.push(result.block);
      }
      columns.push(blocks);
    }
    return { ok: true, block: { id, type, columns } };
  }

  return { ok: false, error: `${path}.type is not supported.` };
}

export function normalizeEmailDesign(value: unknown): { ok: true; design: EmailDesign } | { ok: false; error: string } {
  if (!isRecord(value) || value.version !== 1) return { ok: false, error: 'design must use version 1.' };
  if (!isRecord(value.theme)) return { ok: false, error: 'design.theme must be an object.' };
  if (!Array.isArray(value.blocks) || value.blocks.length > 50) return { ok: false, error: 'design.blocks must contain at most 50 blocks.' };

  const background = safeColor(value.theme.background, 'design.theme.background');
  const contentBackground = safeColor(value.theme.contentBackground, 'design.theme.contentBackground');
  const textColor = safeColor(value.theme.textColor, 'design.theme.textColor');
  const accentColor = safeColor(value.theme.accentColor, 'design.theme.accentColor');
  if (!background.ok) return background;
  if (!contentBackground.ok) return contentBackground;
  if (!textColor.ok) return textColor;
  if (!accentColor.ok) return accentColor;
  const contentWidth = value.theme.contentWidth;
  if (typeof contentWidth !== 'number' || !Number.isInteger(contentWidth) || contentWidth < 320 || contentWidth > 680) return { ok: false, error: 'design.theme.contentWidth must be between 320 and 680 pixels.' };
  const font = value.theme.font === undefined ? 'sans' : value.theme.font;
  if (font !== 'sans' && font !== 'georgia' && font !== 'arial') return { ok: false, error: 'design.theme.font must be sans, georgia, or arial.' };

  const seenIds = new Set<string>();
  const blocks: EmailDesignBlock[] = [];
  let count = 0;
  for (const [index, block] of value.blocks.entries()) {
    count += 1;
    const result = validateBlock(block, `design.blocks[${index}]`, seenIds);
    if (!result.ok) return result;
    if (result.block.type === 'columns') count += result.block.columns.reduce((total, column) => total + column.length, 0);
    if (count > 50) return { ok: false, error: 'design may contain at most 50 blocks, including column contents.' };
    blocks.push(result.block);
  }

  return { ok: true, design: { version: 1, theme: { background: background.value, contentBackground: contentBackground.value, textColor: textColor.value, accentColor: accentColor.value, contentWidth, font }, blocks } };
}

function escapeAttribute(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function escapeText(value: string) {
  const variables: string[] = [];
  const escaped = value.replace(TEMPLATE_VARIABLE, (match) => `\u0001${variables.push(match) - 1}\u0001`)
    .replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
    .replace(/\n/g, '<br>');
  return escaped.replace(/\u0001(\d+)\u0001/g, (_match, index: string) => variables[Number(index)] ?? '');
}

function renderBlocks(blocks: EmailDesignBlock[], design: EmailDesign): string {
  const fontFamily = design.theme.font === 'georgia' ? 'Georgia,serif' : design.theme.font === 'arial' ? 'Arial,Helvetica,sans-serif' : "'Schibsted Grotesk',Arial,sans-serif";
  return blocks.map((block) => {
    if (block.type === 'heading') return `<tr><td align="${block.alignment}" style="padding:${block.spaceAbove ?? 12}px 28px ${block.spaceBelow ?? 12}px;color:${block.color ?? design.theme.textColor};font-family:${fontFamily};font-size:${block.fontSize}px;font-weight:700;line-height:1.25;">${escapeText(block.content)}</td></tr>`;
    if (block.type === 'text') return `<tr><td align="${block.alignment}" style="padding:${block.spaceAbove ?? 10}px 28px ${block.spaceBelow ?? 10}px;color:${block.color ?? design.theme.textColor};font-family:${fontFamily};font-size:${block.fontSize}px;line-height:1.6;">${escapeText(block.content)}</td></tr>`;
    if (block.type === 'image') {
      if (!block.src) return `<tr><td style="padding:12px 28px;"></td></tr>`;
      const image = `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" width="${design.theme.contentWidth - 56}" style="display:block;width:100%;max-width:${design.theme.contentWidth - 56}px;height:auto;border:0;">`;
      const content = block.href ? `<a href="${escapeAttribute(block.href)}" style="display:block;text-decoration:none;">${image}</a>` : image;
      return `<tr><td style="padding:12px 28px;">${content}</td></tr>`;
    }
    if (block.type === 'button') {
      const darkButton = design.theme.accentColor === '#1C1916' || design.theme.accentColor === '#2E6B4B';
      return `<tr><td align="${block.alignment}" style="padding:16px 28px;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="${design.theme.accentColor}" style="border:2px solid #1C1916;border-radius:6px;"><a href="${escapeAttribute(block.href)}" style="display:inline-block;padding:13px 20px;color:${darkButton ? '#FBF9F5' : '#1C1916'};font-family:${fontFamily};font-size:14px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeText(block.label)}</a></td></tr></table></td></tr>`;
    }
    if (block.type === 'divider') return '<tr><td style="padding:10px 28px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid #E3DCD0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>';
    if (block.type === 'spacer') return `<tr><td height="${block.height}" style="height:${block.height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    const columnWidth = Math.floor(100 / block.columns.length);
    const columns = block.columns.map((column) => `<td width="${columnWidth}%" valign="top" style="width:${columnWidth}%;">${column.length ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">${renderBlocks(column, design)}</table>` : '&nbsp;'}</td>`).join('');
    return `<tr><td style="padding:8px 20px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>${columns}</tr></table></td></tr>`;
  }).join('');
}

export function renderEmailDesign(value: EmailDesign): string {
  const normalized = normalizeEmailDesign(value);
  if (!normalized.ok) throw new Error(normalized.error);
  const design = normalized.design;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${design.theme.background};"><center style="width:100%;background:${design.theme.background};"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:${design.theme.background};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="${design.theme.contentWidth}" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:${design.theme.contentWidth}px;background:${design.theme.contentBackground};border:1px solid #E3DCD0;border-radius:8px;overflow:hidden;">${renderBlocks(design.blocks, design)}</table></td></tr></table></center></body></html>`;
}

export function createStarterEmailDesign(): EmailDesign {
  return {
    version: 1,
    theme: { ...DEFAULT_THEME },
    blocks: [
      { id: 'heading-1', type: 'heading', content: 'A little something for you', alignment: 'left', fontSize: 32 },
      { id: 'text-1', type: 'text', content: 'Hello {{{FIRST_NAME}}},\n\nHere is a short note with something useful inside. Add your own copy and make it feel like you.', alignment: 'left', fontSize: 16 },
      { id: 'button-1', type: 'button', label: 'Take a look', href: 'https://example.com', alignment: 'left' },
      { id: 'divider-1', type: 'divider' },
      { id: 'footer-1', type: 'text', content: 'You are receiving this message because you asked to hear from us.', alignment: 'center', fontSize: 12 },
    ],
  };
}
