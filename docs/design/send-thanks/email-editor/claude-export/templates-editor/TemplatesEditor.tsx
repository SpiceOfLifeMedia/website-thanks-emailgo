// Email, thanks · Templates — visual email editor.
// React 18 + TypeScript + CSS modules. No other dependencies.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
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
  toEmailHtml,
  welcomeEmail,
  type Block,
  type BlockKind,
  type EmailFont,
  type EmailTheme,
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
  /** Called by Save draft; resolve to mark the draft saved. Without it, saving is simulated. */
  onSave?: (blocks: Block[], theme: EmailTheme) => Promise<void> | void;
  /** Called with the current HTML whenever Preview is switched on. */
  onPreview?: (html: string) => void;
}

const NAV: { label: string; icon: IconName; count?: string; current?: boolean }[] = [
  { label: 'Overview', icon: 'overview' },
  { label: 'Emails', icon: 'emails' },
  { label: 'Templates', icon: 'templates', count: '3', current: true },
  { label: 'Domains', icon: 'domains' },
  { label: 'Block list', icon: 'blocklist', count: '4' },
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
}: TemplatesEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [theme, setTheme] = useState<EmailTheme>(initialTheme);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialBlocks.find((b) => b.kind === 'text')?.id ?? initialBlocks[0]?.id ?? null,
  );
  const [device, setDevice] = useState<Device>('desktop');
  const [mode, setMode] = useState<Mode>('visual');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [preview, setPreview] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const timer = useRef<number | undefined>(undefined);
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
  const add = (kind: BlockKind) => {
    const block = makeBlock(kind);
    const next = blocks.slice();
    next.splice(index < 0 ? blocks.length : index + 1, 0, block);
    touch(next);
    setSelectedId(block.id);
    setDrawer(null);
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
            <a key={item.label} className={s.navItem} href="#" aria-current={item.current ? 'page' : undefined}>
              <Icon name={item.icon} className={s.icon} />
              <span className={s.navLabel}>{item.label}</span>
              {item.count && <span className={s.navCount}>{item.count}</span>}
            </a>
          ))}
        </nav>
        <div className={s.sideUsage}><span><strong>8</strong> requests this month</span></div>
        <div className={s.sideLinks}>
          <a className={s.sideLink} href="#">Quickstart</a>
          <a className={s.sideLink} href="#">Settings</a>
          <a className={s.sideLink} href="#">Sign out</a>
        </div>
      </aside>

      <div className={s.column}>
        <header className={s.topbar}>
          <Wordmark small />
          {previewButton()}
        </header>

        <main className={s.main}>
          <div className={s.pageHead}>
            <div className={s.headText}>
              <a className={s.backLink} href="#"><Icon name="back" className={s.icon} />Templates</a>
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
                <p className={s.paneNote}>Tap a block to add it under the selected block, or drag it anywhere in the email.</p>
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

              <div className={s.canvasScroll}>
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
            <a key={item.label} className={s.tab} href="#" aria-current={item.current ? 'page' : undefined}>
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
    <a className={cx(s.logo, small && s.logoSmall)} href="#" aria-label="Email, thanks — Overview">
      <SendThanksMark />
      <span>Email<span className={s.comma}>,</span> thanks</span>
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
