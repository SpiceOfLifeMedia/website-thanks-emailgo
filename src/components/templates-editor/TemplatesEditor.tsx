// Send, thanks · Templates — visual email editor.
// React 18 + TypeScript + CSS modules. No other dependencies.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import s from './TemplatesEditor.module.css';
import { Icon, SendThanksMark, type IconName } from './icons';
import {
  BACKGROUNDS,
  BLOCK_LABELS,
  BUTTON_COLOURS,
  DEFAULT_THEME,
  FONT_LABELS,
  FONT_STACKS,
  TEXT_COLOURS,
  TOKENS,
  TRAY,
  VARIABLES,
  makeBlock,
  parseMarkdownTable,
  toEmailHtml,
  welcomeEmail,
  type Block,
  type BlockKind,
  type EmailFont,
  type EmailTheme,
  type TableCell,
  type TextStyle,
} from './blocks';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'savedNow';
export type Device = 'desktop' | 'phone';
export type Mode = 'visual' | 'code';
type Drawer = null | 'blocks' | 'style';

export interface TemplatesEditorProps {
  templateName?: string;
  accountName?: string;
  /** Words shown next to the Draft badge until the first save. */
  lastSavedWords?: string;
  initialBlocks?: Block[];
  initialTheme?: EmailTheme;
  onClose?: () => void;
  saveError?: string;
  /** Called by Save draft; resolve to mark the draft saved. Without it, saving is simulated. */
  onSave?: (blocks: Block[], theme: EmailTheme) => Promise<void> | void;
  /** Called with the current HTML whenever Preview is switched on. */
  onPreview?: (html: string) => void;
}

const NAV: { label: string; icon: IconName; current?: boolean }[] = [
  { label: 'Overview', icon: 'overview' },
  { label: 'Emails', icon: 'emails' },
  { label: 'Templates', icon: 'templates', current: true },
  { label: 'Domains', icon: 'domains' },
  { label: 'Block list', icon: 'blocklist' },
  { label: 'API keys', icon: 'apikeys' },
];
const TABS = [...NAV.slice(0, 4), { label: 'More', icon: 'more' as IconName }];
const EDITABLE: BlockKind[] = ['text', 'heading', 'button', 'image'];

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

export function TemplatesEditor({
  templateName = 'Welcome email',
  accountName = 'Website Thanks',
  lastSavedWords = 'Saved 2 minutes ago',
  initialBlocks = welcomeEmail,
  initialTheme = DEFAULT_THEME,
  onSave,
  onPreview,
  onClose,
  saveError,
}: TemplatesEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [theme, setTheme] = useState<EmailTheme>(initialTheme);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialBlocks.find((b) => b.kind === 'text')?.id ?? initialBlocks[0]?.id ?? null,
  );
  const [selectedTableCell, setSelectedTableCell] = useState({ row: 0, column: 0 });
  const [tableMarkdown, setTableMarkdown] = useState('');
  const [tableMarkdownError, setTableMarkdownError] = useState('');
  const [pendingTableMarkdown, setPendingTableMarkdown] = useState('');
  const [device, setDevice] = useState<Device>('desktop');
  const [mode, setMode] = useState<Mode>('visual');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [preview, setPreview] = useState(false);
  const [save, setSave] = useState<SaveState>(onSave ? 'unsaved' : 'saved');
  const timer = useRef<number | undefined>(undefined);
  const tableCellInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const saveWords: Record<SaveState, string> = {
    saved: lastSavedWords,
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    savedNow: 'Saved just now',
  };

  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const index = selected ? blocks.indexOf(selected) : -1;
  const widthPx = device === 'phone' ? 360 : 600;
  const html = useMemo(() => toEmailHtml(blocks, theme, widthPx), [blocks, theme, widthPx]);
  const darkButton = theme.button === TOKENS.ink || theme.button === TOKENS.basil;

  const touch = useCallback((next: Block[]) => {
    setBlocks(next);
    setSave('unsaved');
  }, []);
  const update = (id: string, patch: Partial<Block>) =>
    touch(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const updateStyle = (patch: Partial<TextStyle>) => {
    if (!selected?.style) return;
    update(selected.id, { style: { ...selected.style, ...patch } });
  };
  const setThemeValue = <K extends keyof EmailTheme>(key: K, value: EmailTheme[K]) => {
    setTheme({ ...theme, [key]: value });
    setSave('unsaved');
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = blocks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    touch(next);
  };
  const remove = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id);
    const next = blocks.filter((b) => b.id !== id);
    touch(next);
    if (selectedId === id) setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const insertBlock = (block: Block) => {
    const next = blocks.slice();
    next.splice(index < 0 ? blocks.length : index + 1, 0, block);
    touch(next);
    setSelectedId(block.id);
    setDrawer(null);
  };
  const selectedTable = selected?.kind === 'table' ? selected : null;
  const tableRows = selectedTable?.rows ?? [];
  const tableColumnCount = tableRows[0]?.length ?? 0;
  const tableRow = Math.min(selectedTableCell.row, Math.max(tableRows.length - 1, 0));
  const tableColumn = Math.min(selectedTableCell.column, Math.max(tableColumnCount - 1, 0));
  const selectedTableCellValue = tableRows[tableRow]?.[tableColumn];
  const tableInputId = (row: number, column: number) => `${selectedTable?.id ?? 'table'}-${row}-${column}`;
  const focusTableCell = (row: number, column: number) => {
    const id = tableInputId(row, column);
    window.requestAnimationFrame(() => tableCellInputs.current[id]?.focus());
  };
  const patchTable = (patch: Partial<Block>) => {
    if (!selectedTable) return;
    update(selectedTable.id, patch);
  };
  const patchTableCell = (rowIndex: number, columnIndex: number, cell: NonNullable<Block['rows']>[number][number]) => {
    if (!selectedTable?.rows) return;
    const rows = selectedTable.rows.map((row, currentRow) => row.map((current, currentColumn) =>
      currentRow === rowIndex && currentColumn === columnIndex ? cell : current,
    ));
    patchTable({ rows });
  };
  const addTableRow = (focus = true) => {
    if (!selectedTable || tableRows.length >= 8) return;
    const columnCount = Math.max(tableColumnCount, 1);
    const insertAt = Math.min(tableRow + 1, tableRows.length);
    const rows = tableRows.map((row) => row.map((cell) => ({ ...cell })));
    rows.splice(insertAt, 0, Array.from({ length: columnCount }, () => ({ type: 'text' as const, text: '' })));
    patchTable({ rows });
    setSelectedTableCell({ row: insertAt, column: tableColumn });
    if (focus) focusTableCell(insertAt, tableColumn);
  };
  const removeTableRow = () => {
    if (!selectedTable || tableRows.length <= 1) return;
    const rows = tableRows.filter((_, rowIndex) => rowIndex !== tableRow);
    patchTable({ rows });
    setSelectedTableCell({ row: Math.min(tableRow, rows.length - 1), column: tableColumn });
  };
  const addTableColumn = () => {
    if (!selectedTable || tableColumnCount >= 4) return;
    const insertAt = Math.min(tableColumn + 1, tableColumnCount);
    const rows = tableRows.map((row) => {
      const next = row.map((cell) => ({ ...cell }));
      next.splice(insertAt, 0, { type: 'text' as const, text: '' });
      return next;
    });
    const alignments = [...(selectedTable.alignments ?? Array.from({ length: tableColumnCount }, () => 'left' as const))];
    alignments.splice(insertAt, 0, 'left');
    patchTable({ rows, alignments });
    setSelectedTableCell({ row: tableRow, column: insertAt });
    focusTableCell(tableRow, insertAt);
  };
  const removeTableColumn = () => {
    if (!selectedTable || tableColumnCount <= 1) return;
    const rows = tableRows.map((row) => row.filter((_, columnIndex) => columnIndex !== tableColumn));
    const alignments = (selectedTable.alignments ?? []).filter((_, columnIndex) => columnIndex !== tableColumn);
    patchTable({ rows, alignments });
    setSelectedTableCell({ row: tableRow, column: Math.min(tableColumn, tableColumnCount - 2) });
  };
  const replaceTableFromMarkdown = () => {
    if (!selectedTable) return;
    const parsed = parseMarkdownTable(tableMarkdown);
    if (!parsed) {
      setTableMarkdownError('Check the Markdown table. It needs a separator row, up to 8 rows and up to 4 columns.');
      return;
    }
    patchTable({
      content: parsed.content,
      rows: parsed.rows,
      headerRow: parsed.headerRow,
      headerColumn: parsed.headerColumn,
      alignments: parsed.alignments,
      borderMode: parsed.borderMode,
      stripedRows: parsed.stripedRows,
      borderColor: parsed.borderColor,
      cellBackground: parsed.cellBackground,
      cellPadding: parsed.cellPadding,
    });
    setSelectedTableCell({ row: 0, column: 0 });
    setTableMarkdown('');
    setTableMarkdownError('');
    setPendingTableMarkdown('');
  };
  const replacePastedTable = (markdown: string) => {
    if (!selectedTable) return;
    const parsed = parseMarkdownTable(markdown);
    if (!parsed) return;
    patchTable({
      content: parsed.content,
      rows: parsed.rows,
      headerRow: parsed.headerRow,
      headerColumn: parsed.headerColumn,
      alignments: parsed.alignments,
      borderMode: parsed.borderMode,
      stripedRows: parsed.stripedRows,
      borderColor: parsed.borderColor,
      cellBackground: parsed.cellBackground,
      cellPadding: parsed.cellPadding,
    });
    setSelectedTableCell({ row: 0, column: 0 });
    setPendingTableMarkdown('');
  };
  const handleTableCellKeyDown = (event: KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    if (!selectedTable) return;
    let nextRow = row;
    let nextColumn = column;
    if (event.key === 'Tab' && !event.shiftKey && row === tableRows.length - 1 && column === tableColumnCount - 1 && tableRows.length < 8) {
      event.preventDefault();
      addTableRow();
      return;
    }
    if (event.key === 'ArrowDown' && row < tableRows.length - 1) nextRow += 1;
    else if (event.key === 'ArrowUp' && row > 0) nextRow -= 1;
    else if (event.altKey && event.key === 'ArrowRight' && column < tableColumnCount - 1) nextColumn += 1;
    else if (event.altKey && event.key === 'ArrowLeft' && column > 0) nextColumn -= 1;
    else if (event.key === 'Enter' && row < tableRows.length - 1) nextRow += 1;
    else return;
    event.preventDefault();
    setSelectedTableCell({ row: nextRow, column: nextColumn });
    focusTableCell(nextRow, nextColumn);
  };
  const add = (kind: BlockKind) => insertBlock(makeBlock(kind));
  const handleCanvasPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const table = parseMarkdownTable(event.clipboardData.getData('text/plain'));
    if (!table) return;
    event.preventDefault();
    insertBlock(table);
  };
  const insertVariable = (e: ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    e.target.value = '';
    if (!name || !selected || !EDITABLE.includes(selected.kind) || selected.kind === 'image') return;
    update(selected.id, { content: `${selected.content.replace(/\s+$/, '')} {{${name}}}` });
  };
  const saveDraft = async () => {
    if (save === 'saving') return;
    setSave('saving');
    try {
      if (onSave) await onSave(blocks, theme);
      else await new Promise<void>((r) => { timer.current = window.setTimeout(r, 900); });
      setSave('savedNow');
    } catch {
      setSave('unsaved');
    }
  };
  const togglePreview = () => {
    const next = !preview;
    setPreview(next);
    if (next) onPreview?.(html);
  };

  const selLabel = selected
    ? `${BLOCK_LABELS[selected.kind]} block · ${index + 1} of ${blocks.length}`.toUpperCase()
    : 'NOTHING SELECTED';
  const canvasWords = `${mode === 'code' ? 'Source · ' : 'Shown at '}${widthPx} px wide · ${device}`;

  const textCss = (st?: TextStyle): CSSProperties | undefined =>
    st && { fontSize: st.fontSize, textAlign: st.align, color: st.color, marginTop: st.spaceAbove, marginBottom: st.spaceBelow };

  const withVars = (text: string): ReactNode[] =>
    text.split(/(\{\{\w+\}\})/g).map((part, i) => {
      const m = /^\{\{(\w+)\}\}$/.exec(part);
      return m ? <span key={i} className={s.var}>{m[1]}</span> : part;
    });

  const renderContent = (block: Block) => {
    switch (block.kind) {
      case 'image':
        return block.src ? (
          <img className={s.img} src={block.src} alt={block.content} width={200} />
        ) : (
          <div className={s.imgPh}><Icon name="image" className={s.icon} />IMAGE · {block.content.toUpperCase()}</div>
        );
      case 'heading':
        return <h2 className={s.emHead} style={textCss(block.style)}>{withVars(block.content)}</h2>;
      case 'text':
        return <p className={s.emText} style={textCss(block.style)}>{withVars(block.content)}</p>;
      case 'button':
        return (
          <a className={s.emBtn} href={block.href} onClick={(e) => e.preventDefault()}
            style={{ background: theme.button, color: darkButton ? TOKENS.chalk : TOKENS.ink }}>
            {withVars(block.content)}
          </a>
        );
      case 'spacer':
        return <div className={s.emSpacer} style={{ height: block.height ?? 24 }}>SPACER · {block.height ?? 24} PX</div>;
      case 'divider':
        return <hr className={s.emRule} />;
      case 'table': {
        const rows = block.rows ?? [];
        const borderColor = block.borderColor ?? TOKENS.line;
        const borderStyle: CSSProperties = block.borderMode === 'none'
          ? { border: 0 }
          : block.borderMode === 'horizontal'
            ? { borderTop: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}` }
            : { border: `1px solid ${borderColor}` };
        const renderRow = (row: TableCell[], rowIndex: number) => {
          const isHeaderRow = Boolean(block.headerRow && rowIndex === 0);
          const striped = Boolean(block.stripedRows && !isHeaderRow && (rowIndex - Number(Boolean(block.headerRow))) % 2 === 1);
          return (
            <tr key={`${block.id}-row-${rowIndex}`}>
              {row.map((cell, columnIndex) => {
                const isHeaderColumn = Boolean(block.headerColumn && columnIndex === 0 && !isHeaderRow);
                const isHeader = isHeaderRow || isHeaderColumn;
                const style: CSSProperties = {
                  ...borderStyle,
                  padding: block.cellPadding ?? 8,
                  textAlign: block.alignments?.[columnIndex] ?? 'left',
                  background: isHeader ? TOKENS.honey : striped ? TOKENS.paper : (block.cellBackground ?? '#FFFFFF'),
                  fontWeight: isHeader ? 700 : 400,
                };
                const content = cell.type === 'image'
                  ? <img src={cell.src} alt={cell.alt} className={s.tableImage} />
                  : withVars(cell.text);
                return isHeader
                  ? <th key={`${block.id}-${rowIndex}-${columnIndex}`} scope={isHeaderRow ? 'col' : 'row'} style={style}>{content}</th>
                  : <td key={`${block.id}-${rowIndex}-${columnIndex}`} style={style}>{content}</td>;
              })}
            </tr>
          );
        };
        return (
          <div className={s.tablePreviewWrap}>
            <table className={s.tablePreview}>
              {block.headerRow && rows.length > 0 && <thead>{renderRow(rows[0], 0)}</thead>}
              <tbody>
                {rows.slice(block.headerRow ? 1 : 0).map((row, index) => renderRow(row, index + Number(Boolean(block.headerRow))))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'columns2':
      case 'columns3': {
        const n = block.kind === 'columns2' ? 2 : 3;
        return (
          <div className={s.emCols} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {Array.from({ length: n }, (_, i) => <div key={i} className={s.emCol}>COLUMN {i + 1}</div>)}
          </div>
        );
      }
    }
  };

  const previewButton = (extra?: string) => (
    <button type="button" className={cx(s.plainBtn, extra)} aria-pressed={preview} onClick={togglePreview}>
      <Icon name="eye" className={s.icon} />Preview
    </button>
  );

  return (
    <div className={s.root}>
      <aside className={s.sidebar}>
        <div className={s.brand}><Wordmark /></div>
        <div className={s.account}><span className={s.mono}>ACCOUNT</span><span className={s.accountName}>{accountName}</span></div>
        <nav aria-label="Dashboard" className={s.nav}>
          {NAV.map((item) => (
            <a key={item.label} className={s.navItem} href="#" aria-current={item.current ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onClose?.(); }}>
              <Icon name={item.icon} className={s.icon} />
              <span className={s.navLabel}>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className={s.sideUsage}><span><strong>Workspace usage</strong><br />Current totals are shown on Overview.</span></div>
        <div className={s.sideLinks}>
          <button className={s.sideLink} type="button" onClick={onClose}>Back to workspace</button>
        </div>
      </aside>

      <div className={s.column}>
        <header className={s.topbar}>
          <Wordmark small />
          {previewButton()}
          {onClose && <button type="button" className={s.closeEditor} onClick={onClose}>Close editor</button>}
        </header>

        <main className={s.main}>
          <div className={s.pageHead}>
            <div className={s.headText}>
              <a className={s.backLink} href="#" onClick={(event) => { event.preventDefault(); onClose?.(); }}><Icon name="back" className={s.icon} />Templates</a>
              <h1 className={s.h1}>Templates</h1>
              <div className={s.headLine}>
                <strong className={s.tplName}>{templateName}</strong>
                <span className={cx(s.badge, s.badgeDraft)}>Draft</span>
                <span role="status" aria-live="polite">{saveWords[save]}</span>
              </div>
            </div>
            <div className={s.actions}>
              {previewButton(s.deskOnly)}
              <button type="button" className={s.primary} onClick={saveDraft} disabled={save === 'saving'}>Save draft</button>
            </div>
          </div>
          {saveError && <p role="alert" className={s.saveError}>{saveError}</p>}

          <div className={s.bench} data-preview={preview}>
            {/* Block tray — a bottom sheet on the phone */}
            <aside className={s.pane} aria-label="Blocks" data-open={drawer === 'blocks'}>
              <div className={s.paneHead}>
                <div className={s.paneTitle}><h2 className={s.h2}>Blocks</h2><span className={s.mono}>TAP OR DRAG</span></div>
                <button type="button" className={s.closeBtn} aria-label="Close Blocks" onClick={() => setDrawer(null)}><Icon name="close" className={s.icon} /></button>
              </div>
              <div className={s.paneBody}>
                <div className={s.trayList}>
                  {TRAY.map((kind) => (
                    <button key={kind} type="button" className={s.blockBtn} onClick={() => add(kind)}>
                      <Icon name={kind} className={s.icon} /><span>{BLOCK_LABELS[kind]}</span>
                    </button>
                  ))}
                </div>
                <p className={s.paneNote}>Tap to add after the selected block. Use Move up and Move down to reorder.</p>
              </div>
            </aside>

            {/* Canvas */}
            <section className={s.canvas} aria-label="Email canvas">
              <div className={s.canvasBar}>
                <div className={s.barGroup}>
                  <div className={s.seg} role="group" aria-label="Editor mode">
                    <SegButton icon="visual" label="Visual" pressed={mode === 'visual'} onClick={() => setMode('visual')} />
                    <SegButton icon="code" label="Code" pressed={mode === 'code'} onClick={() => setMode('code')} />
                  </div>
                  <div className={s.seg} role="group" aria-label="Canvas size">
                    <SegButton icon="desktop" label="Desktop" pressed={device === 'desktop'} onClick={() => setDevice('desktop')} />
                    <SegButton icon="phone" label="Phone" pressed={device === 'phone'} onClick={() => setDevice('phone')} />
                  </div>
                </div>
                <div className={s.selectWrap}>
                  <Icon name="braces" className={s.icon} />
                  <label className={s.srOnly} htmlFor="insertVar">Insert variable</label>
                  <select id="insertVar" className={s.select} defaultValue="" onChange={insertVariable}>
                    <option value="">Insert variable…</option>
                    {VARIABLES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <Icon name="chevronDown" className={cx(s.icon, s.chev)} />
                </div>
              </div>

              <div className={s.canvasScroll} onPaste={handleCanvasPaste}>
                {mode === 'visual' ? (
                  <div className={s.email} style={{ width: widthPx, background: theme.background, fontFamily: FONT_STACKS[theme.font] }}>
                    {blocks.map((block, i) => {
                      const isSel = block.id === selectedId;
                      const label = BLOCK_LABELS[block.kind];
                      return (
                        <div key={block.id} className={s.blk} data-selected={isSel} onClick={() => setSelectedId(block.id)}>
                          <button type="button" className={s.blkTag} aria-pressed={isSel} onClick={() => setSelectedId(block.id)}>
                            {label}{isSel ? ' · selected' : ''}
                          </button>
                          {isSel && !preview && (
                            <div className={s.blkTools} role="group" aria-label={`${label} block actions`}>
                              <button type="button" className={s.tool} onClick={() => move(block.id, -1)} disabled={i === 0}><Icon name="up" className={s.icon} />Move up</button>
                              <button type="button" className={s.tool} onClick={() => move(block.id, 1)} disabled={i === blocks.length - 1}><Icon name="down" className={s.icon} />Move down</button>
                              <button type="button" className={s.tool} onClick={() => remove(block.id)}><Icon name="trash" className={s.icon} />Delete</button>
                            </div>
                          )}
                          {renderContent(block)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <pre className={s.code} aria-label="Email source">{html}</pre>
                )}
                <p className={cx(s.canvasHint, s.mono)}>{canvasWords}</p>
              </div>
            </section>

            {/* Inspector — the Style sheet on the phone */}
            <aside className={s.pane} aria-label="Style" data-open={drawer === 'style'}>
              <div className={s.paneHead}>
                <div className={s.paneTitle}><h2 className={s.h2}>Style</h2><span className={s.mono}>{selLabel}</span></div>
                <button type="button" className={s.closeBtn} aria-label="Close Style" onClick={() => setDrawer(null)}><Icon name="close" className={s.icon} /></button>
              </div>
              <div className={s.paneBody}>
                {!selected && <p className={s.emptyNote}>Select a block in the email to style it.</p>}

                {selected && EDITABLE.includes(selected.kind) && (
                  <div className={s.field}>
                    <label className={s.label} htmlFor="blockContent">{selected.kind === 'image' ? 'Alt text' : 'Content'}</label>
                    <textarea id="blockContent" className={s.textarea} rows={4} value={selected.content}
                      onChange={(e) => update(selected.id, { content: e.target.value })} />
                  </div>
                )}

                {selectedTable && (
                  <section className={s.tableEditor} aria-labelledby="tableEditorTitle">
                    <div className={s.tableEditorHead}>
                      <div>
                        <h3 className={s.h3} id="tableEditorTitle">Table</h3>
                        <span className={s.mono}>{tableRows.length} ROWS · {tableColumnCount} COLUMNS</span>
                      </div>
                      <button type="button" className={s.tool} onClick={() => remove(selectedTable.id)}>
                        <Icon name="trash" className={s.icon} />Remove table
                      </button>
                    </div>

                    {pendingTableMarkdown && (
                      <div className={s.tableConfirm} role="group" aria-label="Replace table confirmation">
                        <p className={s.emptyNote}>Replace this table with the pasted Markdown table?</p>
                        <div className={s.tableActions}>
                          <button type="button" className={s.primary} onClick={() => replacePastedTable(pendingTableMarkdown)}>Replace table</button>
                          <button type="button" className={s.tool} onClick={() => setPendingTableMarkdown('')}>Keep current table</button>
                        </div>
                      </div>
                    )}

                    <div className={s.tableGrid} role="group" aria-label="Table cells">
                      {tableRows.map((row, rowIndex) => (
                        <div className={s.tableGridRow} style={{ gridTemplateColumns: `56px repeat(${row.length}, minmax(54px, 1fr))` }} key={`${selectedTable.id}-edit-row-${rowIndex}`}>
                          <span className={cx(s.mono, s.tableRowLabel)}>{selectedTable.headerRow && rowIndex === 0 ? 'HEADER' : `ROW ${rowIndex + 1}`}</span>
                          {row.map((cell, columnIndex) => {
                            const id = tableInputId(rowIndex, columnIndex);
                            const isSelectedCell = rowIndex === tableRow && columnIndex === tableColumn;
                            const isHeader = Boolean((selectedTable.headerRow && rowIndex === 0) || (selectedTable.headerColumn && columnIndex === 0));
                            return cell.type === 'image' ? (
                              <button
                                key={id}
                                type="button"
                                className={s.tableImageCell}
                                data-selected={isSelectedCell}
                                aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}, image${cell.alt ? `: ${cell.alt}` : ''}`}
                                aria-pressed={isSelectedCell}
                                onFocus={() => setSelectedTableCell({ row: rowIndex, column: columnIndex })}
                                onClick={() => setSelectedTableCell({ row: rowIndex, column: columnIndex })}
                              >
                                <span className={s.imageBadge}>IMAGE</span>
                                <span>{cell.alt || 'Add image alt text'}</span>
                              </button>
                            ) : (
                              <input
                                key={id}
                                ref={(element) => { tableCellInputs.current[id] = element; }}
                                className={s.tableCellInput}
                                data-selected={isSelectedCell}
                                data-header={isHeader}
                                aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}${isHeader ? ', header' : ''}`}
                                maxLength={200}
                                value={cell.text}
                                onFocus={() => setSelectedTableCell({ row: rowIndex, column: columnIndex })}
                                onChange={(event) => patchTableCell(rowIndex, columnIndex, { type: 'text', text: event.target.value })}
                                onKeyDown={(event) => handleTableCellKeyDown(event, rowIndex, columnIndex)}
                                onPaste={(event) => {
                                  const pasted = event.clipboardData.getData('text/plain');
                                  if (pasted.includes('|') && parseMarkdownTable(pasted)) {
                                    event.preventDefault();
                                    setPendingTableMarkdown(pasted);
                                  }
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <p className={s.tableHint}>Select a cell to edit it. Tab in the final cell adds a row. Text cells allow up to 200 characters.</p>

                    {selectedTableCellValue?.type === 'text' && (
                      <div className={s.tableCellTools}>
                        <div className={s.field}>
                          <label className={s.label} htmlFor="cellType">Cell content</label>
                          <select id="cellType" className={s.selectPlain} value="text" onChange={(event) => {
                            if (event.target.value === 'image') patchTableCell(tableRow, tableColumn, { type: 'image', src: '', alt: '' });
                          }}>
                            <option value="text">Text</option>
                            <option value="image">Image</option>
                          </select>
                        </div>
                        <div className={s.field}>
                          <span className={s.label} id="tableColumnAlignLabel">Alignment for column {tableColumn + 1}</span>
                          <div className={cx(s.seg, s.segFull)} role="group" aria-labelledby="tableColumnAlignLabel">
                            <SegButton icon="alignLeft" label="Align left" iconOnly pressed={selectedTable.alignments?.[tableColumn] === 'left'} onClick={() => {
                              const alignments = [...(selectedTable.alignments ?? [])]; alignments[tableColumn] = 'left'; patchTable({ alignments });
                            }} />
                            <SegButton icon="alignCenter" label="Align centre" iconOnly pressed={selectedTable.alignments?.[tableColumn] === 'center'} onClick={() => {
                              const alignments = [...(selectedTable.alignments ?? [])]; alignments[tableColumn] = 'center'; patchTable({ alignments });
                            }} />
                            <SegButton icon="alignRight" label="Align right" iconOnly pressed={selectedTable.alignments?.[tableColumn] === 'right'} onClick={() => {
                              const alignments = [...(selectedTable.alignments ?? [])]; alignments[tableColumn] = 'right'; patchTable({ alignments });
                            }} />
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedTableCellValue?.type === 'text' && /\{\{[^}]*$/.test(selectedTableCellValue.text) && (
                      <p className={s.tableValidation} role="status">Finish the variable with {'}}'} (for example, {'{{first_name}}'}).</p>
                    )}

                    {selectedTableCellValue?.type === 'image' && (
                      <div className={s.tableCellTools}>
                        <div className={s.field}>
                          <label className={s.label} htmlFor="cellType">Cell content</label>
                          <select id="cellType" className={s.selectPlain} value="image" onChange={(event) => {
                            if (event.target.value === 'text') patchTableCell(tableRow, tableColumn, { type: 'text', text: '' });
                          }}>
                            <option value="text">Text</option>
                            <option value="image">Image</option>
                          </select>
                        </div>
                        <div className={s.field}>
                          <label className={s.label} htmlFor="tableImageAddress">Image address</label>
                          <input id="tableImageAddress" className={s.input} type="url" inputMode="url" placeholder="https://example.com/image.jpg"
                            value={selectedTableCellValue.src} onChange={(event) => patchTableCell(tableRow, tableColumn, { ...selectedTableCellValue, src: event.target.value })} />
                          {!selectedTableCellValue.src.startsWith('https://') && <span className={s.tableValidation}>Use a full HTTPS image link.</span>}
                        </div>
                        <div className={s.field}>
                          <label className={s.label} htmlFor="tableImageAlt">Alt text</label>
                          <input id="tableImageAlt" className={s.input} maxLength={125} value={selectedTableCellValue.alt}
                            onChange={(event) => patchTableCell(tableRow, tableColumn, { ...selectedTableCellValue, alt: event.target.value })} />
                          {(!selectedTableCellValue.alt.trim() || selectedTableCellValue.alt.length > 125) && <span className={s.tableValidation}>Describe the image in 1 to 125 characters.</span>}
                        </div>
                      </div>
                    )}

                    <div className={s.tableActions} role="group" aria-label="Rows and columns">
                      <button type="button" className={s.tool} onClick={() => addTableRow(false)} disabled={tableRows.length >= 8}>Add row below</button>
                      <button type="button" className={s.tool} onClick={removeTableRow} disabled={tableRows.length <= 1}>Remove row</button>
                      <button type="button" className={s.tool} onClick={addTableColumn} disabled={tableColumnCount >= 4}>Add column right</button>
                      <button type="button" className={s.tool} onClick={removeTableColumn} disabled={tableColumnCount <= 1}>Remove column</button>
                    </div>

                    <div className={s.tableOptions}>
                      <label className={s.checkField}>
                        <input type="checkbox" checked={Boolean(selectedTable.headerRow)} onChange={(event) => patchTable({ headerRow: event.target.checked })} />
                        First row is a header
                      </label>
                      <label className={s.checkField}>
                        <input type="checkbox" checked={Boolean(selectedTable.headerColumn)} onChange={(event) => patchTable({ headerColumn: event.target.checked })} />
                        First column is a header
                      </label>
                      <label className={s.checkField}>
                        <input type="checkbox" checked={Boolean(selectedTable.stripedRows)} onChange={(event) => patchTable({ stripedRows: event.target.checked })} />
                        Striped rows
                      </label>
                      <div className={s.field}>
                        <label className={s.label} htmlFor="tableBorderMode">Borders</label>
                        <select id="tableBorderMode" className={s.selectPlain} value={selectedTable.borderMode ?? 'all'} onChange={(event) => patchTable({ borderMode: event.target.value as Block['borderMode'] })}>
                          <option value="all">All</option><option value="horizontal">Horizontal</option><option value="none">None</option>
                        </select>
                      </div>
                      <div className={s.field}>
                        <label className={s.label} htmlFor="tableCellPadding">Cell padding</label>
                        <select id="tableCellPadding" className={s.selectPlain} value={selectedTable.cellPadding ?? 8} onChange={(event) => patchTable({ cellPadding: Number(event.target.value) })}>
                          <option value={4}>Tight, 4px</option><option value={8}>Comfortable, 8px</option><option value={12}>Roomy, 12px</option><option value={16}>Spacious, 16px</option>
                        </select>
                      </div>
                    </div>

                    <details className={s.markdownPanel}>
                      <summary>Replace from Markdown</summary>
                      <div className={s.field}>
                        <label className={s.label} htmlFor="tableMarkdown">Paste a Markdown table</label>
                        <textarea id="tableMarkdown" className={s.textarea} rows={5} value={tableMarkdown} onChange={(event) => { setTableMarkdown(event.target.value); setTableMarkdownError(''); }} />
                        <span className={s.tableHint}>The separator row sets each column’s alignment. HTTPS image cells need alt text.</span>
                        {tableMarkdownError && <span role="alert" className={s.tableValidation}>{tableMarkdownError}</span>}
                        <button type="button" className={s.primary} onClick={replaceTableFromMarkdown}>Replace table</button>
                      </div>
                    </details>
                  </section>
                )}

                {selected?.style && (
                  <>
                    <div className={s.row2}>
                      <Stepper id="fontSize" label="Font size" value={selected.style.fontSize} min={12} max={40}
                        onChange={(v) => updateStyle({ fontSize: v })} />
                      <div className={s.field}>
                        <span className={s.label} id="alignLabel">Alignment</span>
                        <div className={cx(s.seg, s.segFull)} role="group" aria-labelledby="alignLabel">
                          <SegButton icon="alignLeft" label="Align left" iconOnly pressed={selected.style.align === 'left'} onClick={() => updateStyle({ align: 'left' })} />
                          <SegButton icon="alignCenter" label="Align centre" iconOnly pressed={selected.style.align === 'center'} onClick={() => updateStyle({ align: 'center' })} />
                          <SegButton icon="alignRight" label="Align right" iconOnly pressed={selected.style.align === 'right'} onClick={() => updateStyle({ align: 'right' })} />
                        </div>
                      </div>
                    </div>
                    <Swatches id="textColour" label="Text colour" options={TEXT_COLOURS} value={selected.style.color}
                      onChange={(v) => updateStyle({ color: v })} />
                    <div className={s.row2}>
                      <Stepper id="spaceAbove" label="Space above" value={selected.style.spaceAbove} min={0} max={48} step={4}
                        onChange={(v) => updateStyle({ spaceAbove: v })} />
                      <Stepper id="spaceBelow" label="Space below" value={selected.style.spaceBelow} min={0} max={48} step={4}
                        onChange={(v) => updateStyle({ spaceBelow: v })} />
                    </div>
                  </>
                )}

                {selected?.kind === 'spacer' && (
                  <Stepper id="spacerHeight" label="Height" value={selected.height ?? 24} min={8} max={96} step={8}
                    onChange={(v) => update(selected.id, { height: v })} />
                )}

                <div className={s.themeHead}><h3 className={s.h3}>Email theme</h3><span className={s.mono}>ALL BLOCKS</span></div>
                <div className={s.row2}>
                  <Swatches id="bg" label="Background" options={BACKGROUNDS} value={theme.background} onChange={(v) => setThemeValue('background', v)} />
                  <Swatches id="btn" label="Buttons" options={BUTTON_COLOURS} value={theme.button} onChange={(v) => setThemeValue('button', v)} />
                </div>
                <div className={s.field}>
                  <label className={s.label} htmlFor="emailFont">Font</label>
                  <div className={cx(s.selectWrap, s.selectFull)}>
                    <select id="emailFont" className={cx(s.select, s.selectPlain)} value={theme.font}
                      onChange={(e) => setThemeValue('font', e.target.value as EmailFont)}>
                      {(Object.keys(FONT_LABELS) as EmailFont[]).map((f) => <option key={f} value={f}>{FONT_LABELS[f]}</option>)}
                    </select>
                    <Icon name="chevronDown" className={cx(s.icon, s.chev)} />
                  </div>
                </div>
              </div>
            </aside>

            {/* Phone only: drawer handles and scrim */}
            <div className={s.handles}>
              <button type="button" className={s.handleBtn} aria-expanded={drawer === 'blocks'} onClick={() => setDrawer(drawer === 'blocks' ? null : 'blocks')}>
                <Icon name="blocks" className={s.icon} />Blocks<Icon name="chevronUp" className={cx(s.icon, s.chev)} />
              </button>
              <button type="button" className={s.handleBtn} aria-expanded={drawer === 'style'} onClick={() => setDrawer(drawer === 'style' ? null : 'style')}>
                <Icon name="sliders" className={s.icon} />Style<Icon name="chevronUp" className={cx(s.icon, s.chev)} />
              </button>
            </div>
            {drawer && <button type="button" className={s.scrim} aria-label="Close drawer" onClick={() => setDrawer(null)} />}
          </div>
        </main>

        <nav aria-label="Dashboard" className={s.tabbar}>
          {TABS.map((item) => (
            <a key={item.label} className={s.tab} href="#" aria-current={item.current ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onClose?.(); }}>
              <Icon name={item.icon} className={s.icon} />{item.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <a className={cx(s.logo, small && s.logoSmall)} href="#" aria-label="Send, thanks — Overview">
      <SendThanksMark />
      <span>Send<span className={s.comma}>,</span> thanks</span>
    </a>
  );
}

function SegButton({ icon, label, pressed, onClick, iconOnly = false }: {
  icon: IconName; label: string; pressed: boolean; onClick: () => void; iconOnly?: boolean;
}) {
  return (
    <button type="button" className={s.segBtn} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <Icon name={icon} className={s.icon} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

function Stepper({ id, label, value, min, max, step = 1, unit = 'px', onChange }: {
  id: string; label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className={s.field}>
      <span className={s.label} id={`${id}Label`}>{label}</span>
      <div className={s.stepper} role="group" aria-labelledby={`${id}Label`}>
        <button type="button" className={s.stepBtn} aria-label={`Less ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - step))}>−</button>
        <span className={s.stepVal} aria-live="polite">{value} {unit}</span>
        <button type="button" className={s.stepBtn} aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

function Swatches({ id, label, options, value, onChange }: {
  id: string; label: string; options: ReadonlyArray<{ name: string; value: string }>; value: string; onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={s.field}>
      <div className={s.labelRow}>
        <span className={s.label} id={`${id}Label`}>{label}</span>
        <span className={s.mono}>{current ? `${current.name} ${current.value}` : value}</span>
      </div>
      <div className={s.swatches} role="group" aria-labelledby={`${id}Label`}>
        {options.map((o) => (
          <button key={o.value} type="button" className={s.swatch} style={{ background: o.value }}
            aria-label={o.name} aria-pressed={o.value === value} onClick={() => onChange(o.value)} />
        ))}
      </div>
    </div>
  );
}

export default TemplatesEditor;
