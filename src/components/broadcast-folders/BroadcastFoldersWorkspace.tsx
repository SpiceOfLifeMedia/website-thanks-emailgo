'use client';

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './broadcast-folders-workspace.module.css';

export type CampaignStatus = 'draft' | 'scheduled' | 'sent' | (string & {});
export type CampaignStatusFilter = 'all' | 'draft' | 'scheduled' | 'sent';
export interface CampaignFolder { id: string; name: string; campaignCount?: number | null }
export interface CampaignSummary {
  id: string;
  name: string;
  subject?: string | null;
  status: CampaignStatus;
  folderId: string | null;
  statusAt: string;
}
export interface BroadcastFoldersWorkspaceProps {
  folders: CampaignFolder[];
  campaigns: CampaignSummary[];
  totalCampaigns: number;
  selectedFolderId: string | null;
  query: string;
  statusFilter: CampaignStatusFilter;
  listStatus: 'loading' | 'ready' | 'error';
  listError?: string | null;
  now?: string;
  onSelectFolder: (folderId: string | null) => void;
  onSearch: (input: { query: string; status: CampaignStatusFilter }) => void;
  onRetry: () => void;
  onCreateFolder: (name: string) => Promise<CampaignFolder>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onMoveCampaign: (campaignId: string, folderId: string | null) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onEditCampaign: (campaignId: string) => void;
  onDeleteCampaign: (campaignId: string) => void;
  onCancelCampaign: (campaignId: string) => void;
}

type Dialog = null | { type: 'create' } | { type: 'rename' } | { type: 'delete' } | { type: 'move'; campaignId: string } | { type: 'folders' };
type StatusStyle = { label: string; verb: string; tone: string; icon: string };
const STATUS: Record<string, StatusStyle> = {
  draft: { label: 'Draft', verb: 'Edited', tone: 'draft', icon: 'M4 20h4L19 9l-4-4L4 16z' },
  scheduled: { label: 'Scheduled', verb: 'Sends', tone: 'scheduled', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2' },
  sent: { label: 'Sent', verb: 'Sent', tone: 'sent', icon: 'M5 12.5l4.5 4.5L19 7.5' },
  queued: { label: 'Queued', verb: 'Queued', tone: 'scheduled', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2' },
  sending: { label: 'Sending', verb: 'Sending', tone: 'scheduled', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2' },
  canceled: { label: 'Canceled', verb: 'Canceled', tone: 'draft', icon: 'M6 6l12 12M18 6L6 18' },
};
const FILTERS: [CampaignStatusFilter, string][] = [['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['sent', 'Sent']];
const ICON = {
  all: 'M3 6h18v12H3zM3 7l9 6 9-6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  down: 'M6 9l6 6 6-6',
};
const Svg = ({ d, size = 16, className }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className ?? styles.svg}><path d={d} /></svg>
);

function useCompactLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

function useWhen(now?: string) {
  return useMemo(() => {
    const timeZone = 'Australia/Adelaide';
    const key = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' });
    const date = new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'short' });
    const yearDate = new Intl.DateTimeFormat('en-AU', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
    const fullDate = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const current = now ? new Date(now) : new Date();
    const today = key(current);
    const yesterday = key(new Date(current.getTime() - 864e5));
    const tomorrow = key(new Date(current.getTime() + 864e5));
    const relative = (iso: string) => {
      const value = new Date(iso);
      const day = key(value);
      if (day === today) return 'today, ' + time.format(value);
      if (day === yesterday) return 'yesterday';
      if (day === tomorrow) return 'tomorrow, ' + time.format(value);
      return day.slice(0, 4) === today.slice(0, 4) ? date.format(value) : yearDate.format(value);
    };
    return { relative, full: (iso: string) => fullDate.format(new Date(iso)) };
  }, [now]);
}

export function BroadcastFoldersWorkspace(p: BroadcastFoldersWorkspaceProps) {
  const mobile = useCompactLayout();
  const when = useWhen(p.now);
  const uid = useId();
  const byId = useMemo(() => new Map(p.folders.map((folder) => [folder.id, folder])), [p.folders]);
  const current = p.selectedFolderId ? byId.get(p.selectedFolderId) ?? null : null;
  const title = current?.name ?? 'All campaigns';
  const countOf = (folder: CampaignFolder) => folder.campaignCount ?? p.campaigns.filter((campaign) => campaign.folderId === folder.id).length;
  const [searchDraft, setSearchDraft] = useState(p.query);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setSearchDraft(p.query), [p.query]);
  const close = () => { setDialog(null); setDialogError(''); };
  const open = (next: Dialog) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setDialogError('');
    setDialog(next);
  };
  useEffect(() => {
    if (!dialog) { returnFocus.current?.focus(); return; }
    const element = dialogRef.current;
    if (!element) return;
    (element.querySelector<HTMLElement>('[data-autofocus]') ?? element.querySelector<HTMLElement>('input,button'))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href]'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [dialog?.type]);

  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setDialogError('');
    try { await action(); setNotice(message); close(); }
    catch (cause) { setDialogError(cause instanceof Error ? cause.message : 'That didn’t work. Please try again.'); }
    finally { setBusy(false); }
  };
  const dialogType = dialog?.type;
  const trimmedName = name.trim();
  const duplicate = !!trimmedName && p.folders.some((folder) => folder.name.toLowerCase() === trimmedName.toLowerCase() && !(dialogType === 'rename' && folder.id === current?.id));
  const invalidName = !trimmedName || duplicate || (dialogType === 'rename' && trimmedName === current?.name) || trimmedName.length > 60 || busy;
  const saveFolderName = (event: FormEvent) => {
    event.preventDefault();
    if (invalidName) return;
    if (dialogType === 'create') {
      void run(async () => { const created = await p.onCreateFolder(trimmedName); p.onSelectFolder(created.id); }, 'Made the “' + trimmedName + '” folder.');
    } else if (dialogType === 'rename' && current) {
      void run(() => p.onRenameFolder(current.id, trimmedName), 'Renamed to “' + trimmedName + '”.');
    }
  };
  const deleteFolder = () => {
    if (!current) return;
    const count = countOf(current);
    void run(async () => { await p.onDeleteFolder(current.id); p.onSelectFolder(null); },
      'Deleted “' + current.name + '”. ' + count + ' ' + (count === 1 ? 'campaign is' : 'campaigns are') + ' still in All campaigns.');
  };
  const moving = dialog?.type === 'move' ? p.campaigns.find((campaign) => campaign.id === dialog.campaignId) ?? null : null;
  const moveCampaign = () => {
    if (!moving) return;
    const destination = moveTo || null;
    void run(() => p.onMoveCampaign(moving.id, destination), 'Moved “' + moving.name + '” to ' + (destination ? byId.get(destination)?.name : 'no folder') + '.');
  };
  const filtering = !!p.query || p.statusFilter !== 'all';
  const search = (event: FormEvent) => { event.preventDefault(); p.onSearch({ query: searchDraft.trim(), status: p.statusFilter }); };
  const filter = (status: CampaignStatusFilter) => p.onSearch({ query: p.query, status });
  const clearFilters = () => { setSearchDraft(''); p.onSearch({ query: '', status: 'all' }); };
  const listFolders = (large: boolean) => (
    <nav aria-label="Campaign folders" className={large ? styles.folderListBig : styles.folderList}>
      <button type="button" aria-current={!current ? 'page' : undefined} className={[styles.folderItem, !current ? styles.on : ''].join(' ')} onClick={() => { p.onSelectFolder(null); if (large) close(); }}>
        {!large && <Svg d={ICON.all} size={20} />}<span className={styles.grow}>All campaigns</span><span className={styles.count}>{p.totalCampaigns}</span>
      </button>
      <div className={styles.sep} role="presentation" />
      {p.folders.map((folder) => {
        const selected = folder.id === current?.id;
        const count = countOf(folder);
        return <button key={folder.id} type="button" aria-current={selected ? 'page' : undefined} aria-label={folder.name + ', ' + count + (count === 1 ? ' campaign' : ' campaigns')}
          className={[styles.folderItem, selected ? styles.on : ''].join(' ')} onClick={() => { p.onSelectFolder(folder.id); if (large) close(); }}>
          {!large && <Svg d={ICON.folder} size={20} />}<span className={styles.name}>{folder.name}</span><span className={styles.count}>{count}</span>
        </button>;
      })}
      {p.folders.length === 0 && <div className={styles.muted}>No folders yet. Make one to group campaigns, like “Spring sale”.</div>}
    </nav>
  );
  const statusBadge = (status: string) => {
    const item = STATUS[status] ?? { label: status.charAt(0).toUpperCase() + status.slice(1), verb: 'Updated', tone: 'draft', icon: ICON.pencil };
    return <span className={[styles.badge, styles[item.tone]].join(' ')}><Svg d={item.icon} size={14} className={styles.badgeSvg} />{item.label}</span>;
  };
  const folderName = (campaign: CampaignSummary) => campaign.folderId ? byId.get(campaign.folderId)?.name ?? 'No folder' : 'No folder';
  const moveDialog = (campaign: CampaignSummary) => { setMoveTo(campaign.folderId ?? ''); open({ type: 'move', campaignId: campaign.id }); };
  const listStatusMessage = p.listStatus === 'loading' ? <div className={styles.loading}><div role="status" className={styles.loadingText}>Loading campaigns…</div>{['55%', '40%', '48%', '36%'].map((width) => <div key={width} className={styles.skel} aria-hidden="true"><div style={{ width }} /><div style={{ width: '70%' }} /></div>)}</div>
    : p.listStatus === 'error' ? <div role="alert" className={styles.error}><div className={styles.stack}><div className={styles.stateTitle}>Couldn’t load campaigns</div><div className={styles.stateBody}>{p.listError || 'Your campaigns and folders have not changed.'}</div></div><button type="button" className={styles.btn} onClick={p.onRetry}>Try again</button></div>
    : p.campaigns.length === 0 ? <div className={styles.empty}><div className={styles.stateTitle}>{filtering ? 'No campaigns match this view' : current ? 'Nothing in ' + current.name + ' yet' : 'No campaigns yet'}</div><div className={styles.stateMuted}>{filtering ? 'Try another word, or show every status.' : 'Campaigns you write in the campaign editor will show up here.'}</div>{filtering && <button type="button" className={styles.btn} onClick={clearFilters}>Clear search and filter</button>}</div>
    : null;
  const listMeta = p.listStatus === 'ready' ? p.campaigns.length + ' ' + (filtering ? 'MATCHING' : p.campaigns.length === 1 ? 'CAMPAIGN' : 'CAMPAIGNS') : '';
  const searchBar = <form role="search" onSubmit={search} className={mobile ? styles.searchM : styles.search}>
    <div className={styles.searchRow}><label className={styles.searchLabel}><span className={styles.srOnly}>Search campaigns</span><Svg d={ICON.search} size={18} className={styles.searchIcon} /><input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={mobile ? 'Search campaigns' : 'Search name or subject'} className={styles.searchInput} /></label>{mobile && filtering && <button type="button" className={styles.btn} onClick={clearFilters}>Clear</button>}</div>
    <div role="group" aria-label="Show campaigns" className={mobile ? styles.filtersM : styles.filters}>{FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={p.statusFilter === id} className={[styles.filter, p.statusFilter === id ? styles.on : ''].join(' ')} onClick={() => filter(id)}>{label}</button>)}</div>
    {!mobile && filtering && <button type="button" className={styles.btn} onClick={clearFilters}>Clear</button>}
  </form>;
  const folderActions = current && <div className={mobile ? styles.twoUp : styles.row}>
    <button type="button" className={styles.btn} aria-label={'Rename folder ' + current.name} onClick={() => { setName(current.name); open({ type: 'rename' }); }}>{!mobile && <Svg d={ICON.pencil} />}Rename</button>
    <button type="button" className={[styles.btn, styles.btnDanger].join(' ')} aria-label={'Delete folder ' + current.name} onClick={() => open({ type: 'delete' })}>{!mobile && <Svg d={ICON.trash} />}Delete folder</button>
  </div>;
  const titleId = uid + '-title';
  const descId = uid + '-description';
  const dialogTitle = dialogType === 'create' ? 'New folder' : dialogType === 'rename' ? 'Rename folder' : dialogType === 'delete' ? 'Delete the “' + (current?.name ?? '') + '” folder?' : dialogType === 'move' ? 'Move campaign' : 'Folders';
  const dialogElement = dialog && <div className={mobile ? styles.overlayM : styles.overlay}>
    <div className={styles.scrim} onClick={close} aria-hidden="true" />
    <div ref={dialogRef} role={dialogType === 'delete' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className={mobile ? styles.sheet : styles.dialog}>
      {mobile && <div className={styles.grab} aria-hidden="true" />}
      <h2 id={titleId} className={styles.dialogTitle}>{dialogTitle}</h2>
      {dialogError && <div role="alert" className={styles.dialogError}>{dialogError}</div>}
      {(dialogType === 'create' || dialogType === 'rename') && <form onSubmit={saveFolderName} className={styles.form}>
        <label className={styles.field}><span className={styles.label}>Folder name</span><input data-autofocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} aria-invalid={duplicate} aria-describedby={descId} placeholder="e.g. Spring sale" className={styles.input} />
          <span id={descId} className={duplicate ? styles.hintError : styles.hint}>{duplicate ? 'You already have a folder with that name. Pick another.' : dialogType === 'rename' ? 'Campaigns in this folder stay where they are.' : 'Up to 60 characters. You can rename it later.'}</span>
        </label><div className={styles.actions}><button type="button" className={styles.btn} onClick={close}>Cancel</button><button type="submit" className={styles.btnTomato} disabled={invalidName}>{busy ? 'Saving…' : dialogType === 'rename' ? 'Save name' : 'Create folder'}</button></div>
      </form>}
      {dialogType === 'delete' && current && <><div id={descId} className={styles.warn}>{countOf(current) ? 'Its ' + countOf(current) + ' ' + (countOf(current) === 1 ? 'campaign goes' : 'campaigns go') + ' back to All campaigns, with no folder.' : 'It has no campaigns in it.'} No campaigns are deleted.</div><div className={styles.actions}><button type="button" data-autofocus className={styles.btn} onClick={close}>Keep folder</button><button type="button" className={styles.btnInk} onClick={deleteFolder} disabled={busy}>{busy ? 'Deleting…' : 'Delete folder'}</button></div></>}
      {dialogType === 'move' && moving && <><div id={descId} className={styles.lead}>Pick a folder for <strong>{moving.name}</strong>. It stays in All campaigns either way.</div><div role="radiogroup" aria-label="Destination folder" className={styles.radios}>{[{ id: '', name: 'No folder (All campaigns only)' }, ...p.folders].map((folder) => { const selected = moveTo === folder.id; return <button key={folder.id || 'none'} type="button" role="radio" aria-checked={selected} data-autofocus={selected || undefined} className={[styles.radio, selected ? styles.on : ''].join(' ')} onClick={() => setMoveTo(folder.id)}><span className={styles.ring}><span className={selected ? styles.dot : undefined} /></span><span className={styles.radioText}>{folder.name}</span></button>; })}</div><div className={styles.actions}><button type="button" className={styles.btn} onClick={close}>Cancel</button><button type="button" className={styles.btnTomato} onClick={moveCampaign} disabled={busy || moveTo === (moving.folderId ?? '')}>{busy ? 'Moving…' : 'Move here'}</button></div></>}
      {dialogType === 'folders' && <><span id={descId} className={styles.srOnly}>Choose which campaigns to show.</span>{listFolders(true)}<button type="button" className={styles.done} onClick={close}>Done</button></>}
    </div>
  </div>;
  const feedback = notice && <div role="status" className={styles.note}><span>{notice}</span><button type="button" className={styles.btn} onClick={() => setNotice('')}>OK</button></div>;
  const campaignRows = p.listStatus === 'ready' && p.campaigns.length > 0 && <ul aria-label={title + ' campaigns'} className={styles.list}>{p.campaigns.map((campaign) => {
    const state = STATUS[campaign.status];
    const statusLabel = state?.label ?? campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1);
    const whenText = (state?.verb ?? 'Updated') + ' ' + when.relative(campaign.statusAt);
    return <li key={campaign.id} className={styles.tRow}>
      <div className={styles.stackTight}><button type="button" className={[styles.cName, styles.nameButton].join(' ')} title={campaign.name} onClick={() => p.onEditCampaign(campaign.id)}>{campaign.name}</button>{campaign.subject && <div className={styles.cSub} title={campaign.subject}>{campaign.subject}</div>}</div>
      <div>{statusBadge(campaign.status)}</div><div className={styles.clip} title={folderName(campaign)}>{folderName(campaign)}</div>
      <time dateTime={campaign.statusAt} title={when.full(campaign.statusAt)} className={styles.when}>{whenText}</time>
      <div className={styles.row}><button type="button" className={styles.btn} aria-haspopup="dialog" aria-label={'Move ' + campaign.name + ' to a folder'} onClick={() => moveDialog(campaign)}>Move</button>{campaign.status === 'draft' && <><button type="button" className={styles.btn} onClick={() => p.onEditCampaign(campaign.id)}>Edit</button><button type="button" className={styles.btn} onClick={() => p.onDeleteCampaign(campaign.id)}>Delete</button></>}{['queued', 'scheduled', 'sending'].includes(campaign.status) && <button type="button" className={styles.btn} onClick={() => p.onCancelCampaign(campaign.id)}>Cancel</button>}</div>
    </li>;
  })}</ul>;
  const mobileRows = p.listStatus === 'ready' && p.campaigns.length > 0 && <ul aria-label={title + ' campaigns'} className={styles.list}>{p.campaigns.map((campaign) => {
    const state = STATUS[campaign.status];
    const whenText = (state?.verb ?? 'Updated') + ' ' + when.relative(campaign.statusAt);
    return <li key={campaign.id} className={styles.cardRowM}>
      <div className={styles.stackTight}><button type="button" className={[styles.cNameM, styles.nameButton].join(' ')} onClick={() => p.onEditCampaign(campaign.id)}>{campaign.name}</button>{campaign.subject && <div className={styles.cSubM}>{campaign.subject}</div>}</div>
      <div className={styles.metaRowM}>{statusBadge(campaign.status)}<span className={styles.clipM}>{folderName(campaign)} · {whenText}</span><button type="button" className={styles.btn} aria-label={'Move ' + campaign.name + ' to a folder'} onClick={() => moveDialog(campaign)}>Move</button></div>
      {campaign.status === 'draft' && <div className={styles.row}><button type="button" className={styles.btn} onClick={() => p.onEditCampaign(campaign.id)}>Edit</button><button type="button" className={styles.btn} onClick={() => p.onDeleteCampaign(campaign.id)}>Delete</button></div>}
      {['queued', 'scheduled', 'sending'].includes(campaign.status) && <button type="button" className={styles.btn} onClick={() => p.onCancelCampaign(campaign.id)}>Cancel</button>}
    </li>;
  })}</ul>;

  return <div className={mobile ? styles.rootM : styles.root}>
    {feedback}
    {!mobile ? <div className={styles.grid}>
      <section aria-labelledby={uid + '-folders'} className={styles.card}><div className={styles.cardHead}><h2 id={uid + '-folders'} className={styles.h2}>Folders</h2><span className={styles.mono}>{p.folders.length} {p.folders.length === 1 ? 'FOLDER' : 'FOLDERS'}</span></div>{listFolders(false)}</section>
      <section aria-labelledby={uid + '-campaigns'} className={[styles.card, styles.minw0].join(' ')}>
        <div className={styles.cardHead}><div className={styles.stackTight}>{current && <div className={styles.crumb}>Folder in All campaigns</div>}<div className={styles.titleLine}><h2 id={uid + '-campaigns'} className={styles.h2}>{title}</h2><span className={styles.mono}>{listMeta}</span></div></div>
          <div className={styles.row}>{current && <><button type="button" className={styles.btn} onClick={() => { setName(current.name); open({ type: 'rename' }); }}><Svg d={ICON.pencil} />Rename</button><button type="button" className={[styles.btn, styles.btnDanger].join(' ')} onClick={() => open({ type: 'delete' })}><Svg d={ICON.trash} />Delete folder</button></>}<button type="button" className={styles.primary} onClick={() => { setName(''); open({ type: 'create' }); }}><Svg d={ICON.plus} size={18} className={styles.svgBold} />New folder</button></div>
        </div>{searchBar}<div aria-busy={p.listStatus === 'loading'}>{listStatusMessage}{p.listStatus === 'ready' && p.campaigns.length > 0 && <div className={styles.tableHead} aria-hidden="true"><div>CAMPAIGN</div><div>STATUS</div><div>FOLDER</div><div>WHEN</div><div /></div>}{campaignRows}</div>
      </section>{dialogElement}
    </div> : <>
      <div className={styles.row}><button type="button" className={styles.switcher} aria-haspopup="dialog" onClick={() => open({ type: 'folders' })}><Svg d={ICON.folder} size={20} /><span className={styles.switcherText}><span className={styles.switcherLabel}>Showing</span><span className={styles.switcherName}>{title}</span></span><Svg d={ICON.down} size={18} className={styles.svgBold} /></button><button type="button" className={styles.primaryM} aria-label="New folder" onClick={() => { setName(''); open({ type: 'create' }); }}><Svg d={ICON.plus} size={18} className={styles.svgBold} />Folder</button></div>
      {folderActions}{searchBar}<section aria-label={title + ' campaigns'} aria-busy={p.listStatus === 'loading'} className={styles.card}><div className={styles.cardHeadM}><h2 className={styles.h2M}>{title}</h2><span className={styles.mono}>{listMeta}</span></div>{listStatusMessage}{mobileRows}</section>{dialogElement}
    </>}
  </div>;
}

export default BroadcastFoldersWorkspace;
