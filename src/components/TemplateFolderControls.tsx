'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import styles from './template-folder-controls.module.css';
import { getTemplateFolderBranchIds } from '@/lib/template-folder-utils';

export type TemplateStatus = 'Draft' | 'Published';
export interface TemplateFolder { id: string; name: string; parentId: string | null }
export interface SavedTemplate { id: string; name: string; subject: string; folderId: string | null; status: TemplateStatus; updatedLabel: string }

export interface TemplateFolderControlsProps {
  folders: TemplateFolder[];
  templates: SavedTemplate[];
  /** null = All templates */
  selectedFolderId: string | null;
  layout?: 'desktop' | 'mobile';
  disabled?: boolean;
  onSelectFolder: (folderId: string | null) => void | Promise<void>;
  onCreateFolder: (input: { name: string; parentId: string | null }) => Promise<TemplateFolder>;
  onMoveTemplate: (input: { templateId: string; folderId: string | null }) => Promise<void>;
  /** Server removes the folder + all descendants and sets their templates' folderId to null. */
  onDeleteFolder: (folderId: string) => Promise<void>;
  renderTemplateActions?: (template: SavedTemplate) => ReactNode;
  renderTemplateDetails?: (template: SavedTemplate) => ReactNode;
}

type Sheet = null | 'folders' | 'create' | 'move' | 'delete';
interface FlatFolder extends TemplateFolder { depth: number }

const I = {
  all: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  Published: 'M5 12.5l4.5 4.5L19 7.5',
  Draft: 'M4 20h4L19 9l-4-4L4 16z',
};
const Icon = ({ d, size = 20, className }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className ?? styles.icon}><path d={d} /></svg>
);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function TemplateFolderControls(p: TemplateFolderControlsProps) {
  const { folders, templates, selectedFolderId: sel, layout = 'desktop' } = p;
  const mobile = layout === 'mobile';
  const uid = useId();

  const kids = useMemo(() => {
    const m = new Map<string | null, TemplateFolder[]>();
    for (const f of folders) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    return m;
  }, [folders]);
  const byId = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders]);
  const descendants = useCallback((id: string): TemplateFolder[] =>
    (kids.get(id) ?? []).flatMap(k => [k, ...descendants(k.id)]), [kids]);
  const pathOf = useCallback((id: string | null): string[] => {
    const out: string[] = []; let f = id ? byId.get(id) : undefined;
    while (f) { out.unshift(f.name); f = f.parentId ? byId.get(f.parentId) : undefined; }
    return out;
  }, [byId]);
  const countIn = useCallback((id: string) => {
    const ids = new Set([id, ...descendants(id).map(f => f.id)]);
    return templates.filter(t => t.folderId && ids.has(t.folderId)).length;
  }, [descendants, templates]);
  const flat = useMemo(() => {
    const acc: FlatFolder[] = [];
    const walk = (parent: string | null, depth: number) => (kids.get(parent) ?? []).forEach(f => { acc.push({ ...f, depth }); walk(f.id, depth + 1); });
    walk(null, 0); return acc;
  }, [kids]);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { // keep the selected folder's ancestors open
    if (!sel) return; const next: Record<string, boolean> = {}; let f = byId.get(sel);
    while (f?.parentId) { next[f.parentId] = true; f = byId.get(f.parentId); }
    setOpen(o => ({ ...o, ...next }));
  }, [sel, byId]);
  const visible = useMemo(() => {
    const acc: FlatFolder[] = [];
    const walk = (parent: string | null, depth: number) => (kids.get(parent) ?? []).forEach(f => { acc.push({ ...f, depth }); if (open[f.id]) walk(f.id, depth + 1); });
    walk(null, 0); return acc;
  }, [kids, open]);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const unavailable = busy || Boolean(p.disabled);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const selFolder = sel ? byId.get(sel) : undefined;
  const inFolder = !!selFolder;
  const selectedBranchIds = useMemo(() => sel ? getTemplateFolderBranchIds(sel, folders.map(f => ({ id: f.id, parent_id: f.parentId }))) : null, [folders, sel]);
  const listed = useMemo(() => selectedBranchIds ? templates.filter(t => t.folderId && selectedBranchIds.has(t.folderId)) : templates, [selectedBranchIds, templates]);
  const subs = sel ? kids.get(sel) ?? [] : [];
  const crumb = sel ? pathOf(sel).slice(0, -1) : [];
  const delDesc = sel ? descendants(sel) : [];
  const delCount = sel ? countIn(sel) : 0;
  const moving = templates.find(t => t.id === movingId);

  const closeAll = useCallback(() => { setSheet(null); setCreating(false); setMovingId(null); setDeleting(false); setError(''); }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  const select = async (id: string | null) => { closeAll(); await p.onSelectFolder(id); };
  const openCreate = (parentId: string | null) => { closeAll(); setNewName(''); setNewParent(parentId ?? ''); setCreating(true); if (mobile) setSheet('create'); };
  const askMove = (t: SavedTemplate) => {
    if (!mobile && movingId === t.id) return setMovingId(null);
    closeAll(); setMovingId(t.id); setMoveTo(t.folderId ?? ''); if (mobile) setSheet('move');
  };
  const askDelete = () => { closeAll(); setDeleting(true); if (mobile) setSheet('delete'); };

  const doCreate = (e?: FormEvent) => {
    e?.preventDefault(); const name = newName.trim(); if (!name || busy) return;
    const parentId = newParent || null;
    run(async () => {
      const f = await p.onCreateFolder({ name, parentId });
      if (parentId) setOpen(o => ({ ...o, [parentId]: true }));
      closeAll(); setNote(`Made “${f.name}”${parentId ? ` inside ${byId.get(parentId)?.name ?? ''}` : ''}.`);
      await p.onSelectFolder(f.id);
    });
  };
  const doMove = (e?: FormEvent) => {
    e?.preventDefault(); if (!moving || busy) return; const folderId = moveTo || null, name = moving.name;
    run(async () => {
      await p.onMoveTemplate({ templateId: moving.id, folderId });
      closeAll(); setNote(`Moved “${name}” to ${folderId ? byId.get(folderId)?.name : 'All templates (no folder)'}.`);
    });
  };
  const doDelete = () => {
    if (!selFolder || busy) return; const name = selFolder.name, n = delCount;
    run(async () => {
      await p.onDeleteFolder(selFolder.id);
      closeAll(); setNote(`Deleted “${name}”. ${plural(n, 'template is', 'templates are')} back in All templates.`);
      await p.onSelectFolder(null);
    });
  };

  const delSubsText = delDesc.length
    ? `Its ${delDesc.length === 1 ? 'subfolder' : `${delDesc.length} subfolders`} (${delDesc.map(f => f.name).join(', ')}) will be removed too.`
    : 'It has no subfolders.';
  const delTplText = delCount
    ? `${delCount === 1 ? 'Its 1 template goes' : `Its ${delCount} templates go`} back to All templates. No templates are deleted.`
    : 'There are no templates in it.';

  const parentOptions = [{ value: '', label: 'None (top level)' }, ...flat.map(f => ({ value: f.id, label: '\u2014 '.repeat(f.depth) + f.name }))];
  const moveOptions = [{ id: '', depth: 0, name: 'No folder (All templates only)' }, ...flat];

  // Keep keyboard and screen-reader focus inside the phone sheet while it is open.
  const sheetRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const sheetStateRef = useRef(sheet);
  useEffect(() => {
    sheetStateRef.current = sheet;
    if (!sheet) return;
    const panel = sheetRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = backgroundRef.current;
    const wasInert = background?.inert ?? false;
    if (background) background.inert = true;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);
    const initial = panel?.querySelector<HTMLElement>('button[aria-current="page"],button[aria-pressed="true"],input:not([disabled]),select:not([disabled]),button:not([disabled])');
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeAll(); return; }
      if (e.key !== 'Tab') return;
      const targets = focusable();
      if (!targets.length) { e.preventDefault(); panel?.focus(); return; }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        e.preventDefault(); first.focus();
      }
    };
    panel?.addEventListener('keydown', onKey);
    return () => {
      panel?.removeEventListener('keydown', onKey);
      if (background) background.inert = wasInert;
      queueMicrotask(() => {
        if (!sheetStateRef.current && previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, [sheet]);

  const renderTree = (big = false) => (
    <nav aria-label="Template folders" className={big ? styles.treeBig : styles.tree}>
      <button type="button" aria-current={!sel ? 'page' : undefined}
        className={`${styles.item} ${!sel ? styles.on : ''}`} onClick={() => select(null)} disabled={unavailable}>
        <Icon d={I.all} /><span className={styles.grow}>All templates</span><span className={styles.count}>{templates.length}</span>
      </button>
      <div className={styles.sep} role="presentation" />
      <div className={styles.treeItems} role="list">
      {visible.map(f => {
        const hasKids = (kids.get(f.id) ?? []).length > 0, isOpen = !!open[f.id], cur = sel === f.id;
        return (
          <div key={f.id} role="listitem"
            className={styles.treeRow} style={{ ['--depth' as string]: f.depth }} data-nested={f.depth > 0 || undefined}>
            {hasKids
              ? <button type="button" className={styles.disclose} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${pathOf(f.id).join(' / ')}`} aria-expanded={isOpen}
                  onClick={() => setOpen(o => ({ ...o, [f.id]: !isOpen }))} disabled={unavailable}><Icon d={I.chevron} size={big ? 18 : 16} className={`${styles.chev} ${isOpen ? styles.chevOpen : ''}`} /></button>
              : <span className={styles.discloseSpacer} aria-hidden="true" />}
            <button type="button" aria-label={`Folder ${pathOf(f.id).join(', ')}, ${countIn(f.id)} templates`} aria-current={cur ? 'page' : undefined} className={`${styles.item} ${cur ? styles.on : ''}`} onClick={() => select(f.id)} disabled={unavailable}>
              {!big && <Icon d={I.folder} />}<span className={styles.name}>{f.name}</span><span className={styles.count}>{countIn(f.id)}</span>
            </button>
          </div>
        );
      })}
      </div>
    </nav>
  );

  const renderBadge = (s: TemplateStatus) => (
    <span className={`${styles.badge} ${s === 'Published' ? styles.published : styles.draft}`}><Icon d={I[s]} size={14} className={styles.badgeIcon} />{s}</span>
  );
  const tplPath = (t: SavedTemplate) => (t.folderId ? pathOf(t.folderId).join(' / ') : 'No folder');
  const listTitle = selFolder ? selFolder.name : 'All templates';
  const listMeta = plural(listed.length, 'TEMPLATE').toUpperCase();

  const renderCreateFields = (big = false) => (
    <>
      <label className={styles.field}><span className={styles.label}>Folder name</span>
        <input className={big ? styles.inputBig : styles.input} name="folderName" autoComplete="off" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Folder name" required maxLength={80} disabled={unavailable} />
      </label>
      <label className={styles.field}><span className={styles.label}>Put it inside <span className={styles.opt}>(optional)</span></span>
        <select className={big ? styles.inputBig : styles.input} name="parentFolder" value={newParent} onChange={e => setNewParent(e.target.value)} disabled={unavailable}>
          {parentOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {big && <span className={styles.hint}>Leave it as “None” to make a top-level folder.</span>}
      </label>
    </>
  );

  const renderNotice = () => (<>
    {note && <div role="status" className={styles.notice}><span>{note}</span><button type="button" className={styles.btn} onClick={() => setNote('')}>OK</button></div>}
    {error && <div role="alert" className={styles.error}>{error}</div>}
  </>);

  if (!mobile) return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.h1}>Saved templates</h2>
          <p className={styles.intro}>Organize reusable emails into folders. Every template stays in All templates.</p>
        </div>
        <button type="button" className={styles.primary} onClick={() => openCreate(null)} disabled={unavailable}><Icon d={I.plus} size={18} className={styles.iconBold} />New folder</button>
      </div>
      {renderNotice()}
      <div className={styles.grid}>
        <section aria-label="Folders" className={styles.card}>
          <div className={styles.cardHead}><h2 className={styles.h2}>Folders</h2><span className={styles.meta}>{plural(folders.length, 'FOLDER')}</span></div>
          {creating && (
            <form aria-label="Create folder" className={styles.createForm} onSubmit={doCreate}>
              {renderCreateFields()}
              <div className={styles.row}>
                <button type="submit" className={styles.btnTomato} disabled={!newName.trim() || unavailable}>Create folder</button>
                <button type="button" className={styles.btn} onClick={closeAll}>Cancel</button>
              </div>
            </form>
          )}
          {renderTree()}
        </section>

        <section aria-label={listTitle} className={`${styles.card} ${styles.minw0}`}>
          <div className={styles.cardHead}>
            <div className={styles.titleBlock}>
              {crumb.length > 0 && <div className={styles.crumb}>In {crumb.join(' / ')}</div>}
              <div className={styles.titleLine}><h2 className={styles.h2}>{listTitle}</h2><span className={styles.meta}>{listMeta}</span></div>
            </div>
            {inFolder && (
              <div className={styles.row}>
                <button type="button" className={styles.btn} onClick={() => openCreate(sel)}>New subfolder</button>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={askDelete}><Icon d={I.trash} size={16} />Delete folder</button>
              </div>
            )}
          </div>
          {deleting && selFolder && (
            <div role="alertdialog" aria-labelledby={`${uid}-dt`} aria-describedby={`${uid}-dd`} className={styles.confirm}>
              <div id={`${uid}-dt`} className={styles.confirmTitle}>Delete the “{selFolder.name}” folder?</div>
              <div id={`${uid}-dd`} className={styles.confirmBody}>{delSubsText} {delTplText}</div>
              <div className={styles.row}>
                <button type="button" className={styles.btnInk} onClick={doDelete} disabled={unavailable}>Delete folder</button>
                <button type="button" className={styles.btn} onClick={closeAll} autoFocus>Keep it</button>
              </div>
            </div>
          )}
          {subs.length > 0 && (
            <div className={styles.subs}><span className={styles.subsLabel}>Subfolders</span>
              {subs.map(f => <button key={f.id} type="button" className={styles.chip} onClick={() => select(f.id)}>{f.name}<span className={styles.count}>{countIn(f.id)}</span></button>)}
            </div>
          )}
          <div className={styles.tableHead} aria-hidden="true"><div>TEMPLATE</div><div>STATUS</div><div>FOLDER</div><div>LAST EDITED</div><div /></div>
          <ul className={styles.list}>
            {listed.map(t => {
              const mv = movingId === t.id;
              return (
                <li key={t.id} className={styles.li}>
                  <div className={`${styles.tRow} ${mv ? styles.tRowMoving : ''}`}>
                    <div className={styles.stack}><div className={styles.tName} title={t.name}>{t.name}</div><div className={styles.tSub} title={t.subject}>{t.subject}</div></div>
                    <div>{renderBadge(t.status)}</div>
                    <div className={styles.clip} title={tplPath(t)}>{tplPath(t)}</div>
                    <div className={styles.date}>{t.updatedLabel}</div>
                    <button type="button" className={styles.btnSm} aria-expanded={mv} aria-label={`Move ${t.name}`} onClick={() => askMove(t)} disabled={unavailable}>Move</button>
                  </div>
                  {mv && (
                    <form aria-label="Move template" className={styles.moveForm} onSubmit={doMove}>
                      <label className={`${styles.field} ${styles.moveField}`}><span className={styles.label}>Move “{t.name}” to</span>
                        <select className={styles.input} name="destinationFolder" value={moveTo} onChange={e => setMoveTo(e.target.value)} autoFocus disabled={unavailable}>
                          {moveOptions.map(o => <option key={o.id} value={o.id}>{o.id ? '\u2014 '.repeat(o.depth) + o.name : o.name}</option>)}
                        </select>
                      </label>
                      <button type="submit" className={styles.btnTomato} disabled={unavailable}>Move here</button>
                      <button type="button" className={styles.btn} onClick={closeAll}>Cancel</button>
                    </form>
                  )}
                  {p.renderTemplateActions && <div className={styles.templateActions}>{p.renderTemplateActions(t)}</div>}
                  {p.renderTemplateDetails && <div className={styles.templateDetails}>{p.renderTemplateDetails(t)}</div>}
                </li>
              );
            })}
          </ul>
          {listed.length === 0 && <div className={styles.empty}>No templates in this folder yet. Use Move on any template to put it here.</div>}
        </section>
      </div>
    </div>
  );

  const sheetTitle = { folders: 'Folders', create: 'New folder', move: 'Move template', delete: `Delete “${selFolder?.name ?? ''}”?` }[sheet ?? 'folders'];
  return (
    <div className={styles.rootM}>
      <div ref={backgroundRef} className={styles.sheetBackground}>
      <div className={styles.headM}>
        <h2 className={styles.h1M}>Saved templates</h2>
        <p className={styles.intro}>Organize reusable emails into folders. Every template stays in All templates.</p>
      </div>
      {renderNotice()}
      <div className={styles.row}>
        <button type="button" className={styles.switcher} aria-haspopup="dialog" onClick={() => { closeAll(); setSheet('folders'); }} disabled={unavailable}>
          <Icon d={I.folder} />
          <span className={styles.switcherText}><span className={styles.switcherLabel}>Showing</span><span className={styles.switcherName}>{listTitle}</span></span>
          <Icon d={I.down} size={18} className={styles.iconBold} />
        </button>
        <button type="button" className={styles.primaryM} onClick={() => openCreate(null)} aria-label="New folder" disabled={unavailable}><Icon d={I.plus} size={18} className={styles.iconBold} />Folder</button>
      </div>
      {inFolder && (
        <div className={styles.stackM}>
          {crumb.length > 0 && <div className={styles.crumbM}>In {crumb.join(' / ')}</div>}
          {subs.length > 0 && <div className={styles.chipsM}>{subs.map(f => <button key={f.id} type="button" className={styles.chipM} onClick={() => select(f.id)}>{f.name}<span className={styles.count}>{countIn(f.id)}</span></button>)}</div>}
          <div className={styles.twoUp}>
            <button type="button" className={styles.btn} onClick={() => openCreate(sel)}>New subfolder</button>
            <button type="button" className={styles.btn} onClick={askDelete}>Delete folder</button>
          </div>
        </div>
      )}
      <section aria-label={listTitle} className={styles.card}>
        <div className={styles.cardHeadM}><h2 className={styles.h2M}>{inFolder ? 'Templates in here' : 'Recent templates'}</h2><span className={styles.meta}>{listMeta}</span></div>
        <ul className={styles.list}>
          {listed.map(t => (
            <li key={t.id} className={styles.cardRowM}>
              <div className={styles.stack}><div className={styles.tNameM}>{t.name}</div><div className={styles.tSubM}>{t.subject}</div></div>
              <div className={styles.metaRowM}>
                {renderBadge(t.status)}
                <span className={styles.clipM}>{tplPath(t)} · {t.updatedLabel}</span>
                <button type="button" className={styles.btn} aria-haspopup="dialog" aria-label={`Move ${t.name}`} onClick={() => askMove(t)} disabled={unavailable}>Move</button>
              </div>
              {p.renderTemplateActions && <div className={styles.templateActions}>{p.renderTemplateActions(t)}</div>}
              {p.renderTemplateDetails && <div className={styles.templateDetails}>{p.renderTemplateDetails(t)}</div>}
            </li>
          ))}
        </ul>
        {listed.length === 0 && <div className={styles.empty}>No templates in this folder yet. Use Move on any template to put it here.</div>}
      </section>
      </div>

      {sheet && (
        <div className={styles.sheetWrap}>
          <div className={styles.scrim} onClick={closeAll} aria-hidden="true" />
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={`${uid}-st`} className={styles.sheet}>
            <div className={styles.grab} aria-hidden="true" />
            <div className={styles.sheetHead}>
              <h2 id={`${uid}-st`} className={styles.sheetTitle}>{sheetTitle}</h2>
              <button type="button" className={styles.btn} onClick={closeAll}>{sheet === 'delete' ? 'Keep it' : sheet === 'folders' ? 'Done' : 'Cancel'}</button>
            </div>
            {error && <div role="alert" className={styles.error}>{error}</div>}
            {sheet === 'folders' && renderTree(true)}
            {sheet === 'create' && (
              <form className={styles.sheetForm} onSubmit={doCreate}>
                {renderCreateFields(true)}
                <button type="submit" className={styles.primaryBlock} disabled={!newName.trim() || unavailable}>Create folder</button>
              </form>
            )}
            {sheet === 'move' && moving && (<>
              <div className={styles.sheetLead}>Pick a folder for <strong>{moving.name}</strong>.</div>
              <div role="group" aria-label="Destination folder" className={styles.radios}>
                {moveOptions.map(o => {
                  const c = moveTo === o.id;
                  return (
                    <button key={o.id || 'none'} type="button" aria-pressed={c} className={`${styles.radio} ${c ? styles.on : ''}`}
                      style={{ ['--depth' as string]: o.depth }} onClick={() => setMoveTo(o.id)}>
                      <span className={styles.radioRing}><span className={c ? styles.radioDot : undefined} /></span>{o.name}
                    </button>
                  );
                })}
              </div>
              <button type="button" className={styles.primaryBlock} onClick={() => doMove()} disabled={unavailable}>Move here</button>
            </>)}
            {sheet === 'delete' && selFolder && (<>
              <div role="alert" className={styles.confirmM}>{delSubsText} {delTplText}</div>
              <button type="button" className={styles.inkBlock} onClick={doDelete} disabled={unavailable}>Delete folder</button>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

export default TemplateFolderControls;
