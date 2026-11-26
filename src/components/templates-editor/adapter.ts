import { createStarterEmailDesign, type EmailDesign, type EmailDesignBlock } from '@/lib/email-design';
import { DEFAULT_THEME, welcomeEmail, type Block, type EmailTheme } from './blocks';

function blockStyle(block: EmailDesignBlock): Block['style'] {
  if (block.type !== 'text' && block.type !== 'heading') return undefined;
  return {
    fontSize: block.fontSize,
    align: block.alignment,
    color: block.color ?? '#3D3832',
    spaceAbove: block.spaceAbove ?? 12,
    spaceBelow: block.spaceBelow ?? 12,
  };
}

export function designToEditor(design: EmailDesign): { blocks: Block[]; theme: EmailTheme } {
  const blocks = design.blocks.map((block): Block => {
    if (block.type === 'text' || block.type === 'heading') return { id: block.id, kind: block.type, content: block.content, style: blockStyle(block) };
    if (block.type === 'image') return { id: block.id, kind: 'image', content: block.alt, src: block.src, imageHref: block.href ?? undefined };
    if (block.type === 'button') return { id: block.id, kind: 'button', content: block.label, href: block.href };
    if (block.type === 'divider') return { id: block.id, kind: 'divider', content: '' };
    if (block.type === 'spacer') return { id: block.id, kind: 'spacer', content: '', height: block.height };
    return { id: block.id, kind: block.columns.length === 3 ? 'columns3' : 'columns2', content: JSON.stringify(block.columns) };
  });
  return {
    blocks,
    theme: { background: design.theme.background, button: design.theme.accentColor, font: design.theme.font ?? 'sans' },
  };
}

export function editorToDesign(blocks: Block[], theme: EmailTheme, previous: EmailDesign): EmailDesign {
  const previousBlocks = new Map(previous.blocks.map((block) => [block.id, block]));
  const nextBlocks = blocks.map((block): EmailDesignBlock => {
    const existing = previousBlocks.get(block.id);
    if (block.kind === 'heading' || block.kind === 'text') {
      return {
        id: block.id,
        type: block.kind,
        content: block.content,
        alignment: block.style?.align ?? (existing?.type === block.kind ? existing.alignment : 'left'),
        fontSize: block.style?.fontSize ?? (existing?.type === block.kind ? existing.fontSize : block.kind === 'heading' ? 28 : 16),
        color: block.style?.color ?? (existing?.type === block.kind ? existing.color : previous.theme.textColor),
        spaceAbove: block.style?.spaceAbove ?? (existing?.type === block.kind ? existing.spaceAbove : 12),
        spaceBelow: block.style?.spaceBelow ?? (existing?.type === block.kind ? existing.spaceBelow : 12),
      };
    }
    if (block.kind === 'image') return { id: block.id, type: 'image', src: block.src ?? '', alt: block.content, href: existing?.type === 'image' ? existing.href : null };
    if (block.kind === 'button') return { id: block.id, type: 'button', label: block.content, href: block.href ?? 'https://example.com', alignment: existing?.type === 'button' ? existing.alignment : 'left' };
    if (block.kind === 'divider') return { id: block.id, type: 'divider' };
    if (block.kind === 'spacer') return { id: block.id, type: 'spacer', height: block.height ?? 24 };
    const columnCount = block.kind === 'columns3' ? 3 : 2;
    let preserved: EmailDesignBlock[][] = [];
    if (existing?.type === 'columns' && existing.columns.length === columnCount) preserved = existing.columns;
    else if (block.content) {
      try {
        const parsed: unknown = JSON.parse(block.content);
        if (Array.isArray(parsed) && parsed.length === columnCount && parsed.every(Array.isArray)) preserved = parsed as EmailDesignBlock[][];
      } catch { /* A fresh column block starts empty. */ }
    }
    return { id: block.id, type: 'columns', columns: preserved.length ? preserved : Array.from({ length: columnCount }, () => []) };
  });
  return {
    version: 1,
    theme: {
      ...previous.theme,
      background: theme.background,
      accentColor: theme.button,
      font: theme.font,
    },
    blocks: nextBlocks,
  };
}

export function createClaudeStarterDesign(): EmailDesign {
  return editorToDesign(welcomeEmail, DEFAULT_THEME, createStarterEmailDesign());
}
