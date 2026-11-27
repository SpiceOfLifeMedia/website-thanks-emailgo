'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { renderEmailDesign, type EmailDesign } from '@/lib/email-design';
import { BroadcastMetadataFields, validatePreviewText, validateReplyTo, type BroadcastMetadataField } from '@/components/BroadcastMetadataFields';
import { ContactActivityPanel, type ContactActivityItem } from '@/components/contact-activity-panel';
import { EmailCompatibilityPanel } from '@/components/EmailCompatibilityPanel';
import { TemplateFolderControls, type SavedTemplate } from '@/components/TemplateFolderControls';
import { TemplatesEditor } from '@/components/templates-editor';
import { createClaudeStarterDesign, designToEditor, editorToDesign } from '@/components/templates-editor/adapter';
import { BroadcastFoldersWorkspace, type CampaignFolder as CampaignFolderView, type CampaignStatusFilter } from '@/components/broadcast-folders/BroadcastFoldersWorkspace';
import type { Block, EmailTheme } from '@/components/templates-editor/blocks';
import type { TemplateFolder } from '@/lib/template-folders';

type TemplateVariable = { id?: string; key: string; type: 'string' | 'number'; fallback_value?: string | number | null; fallbackValue?: string | number | null };
type Template = { id: string; name: string; alias: string | null; from: string | null; reply_to: string | null; subject: string; variables: TemplateVariable[]; folder_id?: string | null; status: 'draft' | 'published'; has_unpublished_versions: boolean; published_at: string | null; created_at: string; updated_at: string };
type TemplateDetail = Template & { html: string | null; text: string | null; design: EmailDesign | null };
type TemplateVersion = { id: string; created_at: string; published_at: string | null; is_current: boolean; is_published: boolean; name: string; subject: string; html: string; text: string | null; alias: string | null; from: string | null; reply_to: string | null; variables: TemplateVariable[] };
type Contact = { id: string; email: string; name: string | null; properties: Record<string, unknown>; tags: string[]; unsubscribed_at: string | null; consent_status: 'unknown' | 'opted_in'; consent_source: string | null; consented_at: string | null; created_at: string; updated_at: string };
type ContactActivityRow = { id: string; type: string; created_at: string; subject: string | null; detail: string | null; email_id: string | null; bounce_type?: 'Permanent' | 'Temporary' | 'Undetermined' };
type ContactActivityState = { items: ContactActivityItem[]; hasMore: boolean; nextAfter: string | null; status: 'loading' | 'ready' | 'error'; loadingMore: boolean; error: string; loadMoreError: string };
type ContactProperty = { id: string; key: string; type: 'string' | 'number'; fallback_value: string | number | null; created_at: string; updated_at: string };
type Segment = { id: string; name: string; filters: { tags_all?: string[]; tags_any?: string[]; consent_status?: 'unknown' | 'opted_in'; unsubscribed?: boolean }; contacts_count: number; created_at: string; updated_at: string };
type Topic = { id: string; name: string; slug: string; description: string | null; subscribers_count: number; created_at: string; updated_at: string };
type BroadcastKey = { id: string; name: string; permission: 'full_access' | 'sending_access'; domain_id: string | null };
type BroadcastDomain = { id: string; domain: string; verified_at: string | null };
type Broadcast = { id: string; name: string; api_key_id: string; from_address: string; subject: string; reply_to: string | null; preview_text: string | null; text_body: string | null; html_body: string | null; design: EmailDesign | null; audience_type: 'segment' | 'topic'; audience_id: string; status: string; scheduled_at: string | null; recipient_count: number; sent_count: number; failed_count: number; suppressed_count: number; pending_count: number; folder_id?: string | null; created_at: string; updated_at: string };
type BroadcastDraft = { name: string; api_key_id: string; from: string; subject: string; reply_to: string; preview_text: string; text: string; html: string; design: EmailDesign | null; audience_type: 'segment' | 'topic'; audience_id: string };

const BROADCAST_METADATA_VALIDATION_ERROR = 'Check the highlighted optional details before saving.';

function toContactActivityItem(row: ContactActivityRow): ContactActivityItem | null {
  const email = row.email_id ? { id: row.email_id, subject: row.subject } : null;
  const base = { id: row.id, occurredAt: row.created_at };
  switch (row.type) {
    case 'contact.created': return { ...base, kind: 'contact_added' };
    case 'contact.unsubscribed': return { ...base, kind: 'unsubscribed' };
    case 'email.sent': return { ...base, kind: 'email_sent', email };
    case 'email.received': return { ...base, kind: 'email_received', email };
    case 'email.opened': return { ...base, kind: 'opened', email };
    case 'email.clicked': return { ...base, kind: 'clicked', email };
    case 'delivery.delivered': return { ...base, kind: 'delivered', email };
    case 'delivery.delayed': return { ...base, kind: 'delayed', email, reason: row.detail };
    case 'delivery.bounced': return { ...base, kind: 'bounced', email, bounceType: row.bounce_type ?? 'Undetermined', bounceSubtype: row.detail };
    case 'delivery.complained': return { ...base, kind: 'complained', email };
    default: return null;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? body?.error ?? `Request failed (${response.status})`);
  return body as T;
}

function localTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function safeEmailPreview(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"></head><body>${html}</body></html>`;
}

function escapePreviewHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function renderTemplatePreview(source: string, variables: Record<string, string>, escapeDoubleBraceValues: boolean) {
  return source.replace(/\{\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}\}|\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}/g, (_match, tripleName: string | undefined, doubleName: string | undefined) => {
    const name = tripleName ?? doubleName;
    if (!name) return '';
    const value = variables[name] ?? '';
    return escapeDoubleBraceValues && !tripleName ? escapePreviewHtml(value) : value;
  });
}

export function TemplatesWorkspace() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [from, setFrom] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [design, setDesign] = useState<EmailDesign | null>(null);
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('html');
  const [editorOpen, setEditorOpen] = useState(false);
  const [variablesJson, setVariablesJson] = useState('[]');
  const [historyId, setHistoryId] = useState('');
  const [history, setHistory] = useState<TemplateVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isPhone, setIsPhone] = useState(false);

  const load = useCallback(async () => {
    try {
      const [templateResult, folderResult] = await Promise.all([
        api<{ data: Template[] }>('/api/templates'),
        api<{ data: TemplateFolder[] }>('/api/template-folders'),
      ]);
      setTemplates(templateResult.data);
      setFolders(folderResult.data);
      setError('');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load templates.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const folderId = new URL(window.location.href).searchParams.get('folder');
    if (folderId) setSelectedFolderId(folderId);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 759px)');
    const sync = () => setIsPhone(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  function selectTemplateFolder(folderId: string | null) {
    setSelectedFolderId(folderId ?? '');
    const url = new URL(window.location.href);
    if (folderId) url.searchParams.set('folder', folderId);
    else url.searchParams.delete('folder');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function clearForm() {
    setEditingId(''); setName(''); setAlias(''); setFrom(''); setReplyTo(''); setSubject(''); setText(''); setHtml(''); setDesign(null); setEditorMode('html'); setVariablesJson('[]');
  }

  async function editTemplate(template: Template) {
    setBusy(true); setError(''); setNotice('');
    try {
      const detail = await api<TemplateDetail>(`/api/templates/${encodeURIComponent(template.id)}`);
      setEditingId(detail.id); setName(detail.name); setAlias(detail.alias ?? ''); setFrom(detail.from ?? ''); setReplyTo(detail.reply_to ?? ''); setSubject(detail.subject); setText(detail.text ?? ''); setHtml(detail.html ?? ''); setDesign(detail.design ?? null); setEditorMode(detail.design ? 'visual' : 'html');
      setVariablesJson(JSON.stringify(detail.variables.map(({ key, type, fallback_value, fallbackValue }) => ({ key, type, fallback_value: fallback_value ?? fallbackValue ?? null })), null, 2));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this template.'); }
    finally { setBusy(false); }
  }

  async function persistTemplate(nextDesign = design) {
    const variables = JSON.parse(variablesJson) as unknown;
    if (!Array.isArray(variables)) throw new Error('Variables must be a JSON array.');
    const wasEditing = Boolean(editingId);
    const payload = { name, alias: alias || null, from: from || null, reply_to: replyTo || null, subject, text: text || null, html: nextDesign ? renderEmailDesign(nextDesign) : html || null, design: nextDesign, variables };
    const saved = await api<TemplateDetail>(wasEditing ? `/api/templates/${encodeURIComponent(editingId)}` : '/api/templates', { method: wasEditing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    setEditingId(saved.id);
    setDesign(nextDesign);
    setHtml(saved.html ?? (nextDesign ? renderEmailDesign(nextDesign) : html));
    await load();
    setNotice(wasEditing ? 'Template updated.' : 'Template created.');
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await persistTemplate(); clearForm(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save template.'); }
    finally { setBusy(false); }
  }

  async function saveVisualTemplate(blocks: Block[], theme: EmailTheme) {
    const nextDesign = editorToDesign(blocks, theme, design ?? createClaudeStarterDesign());
    setBusy(true); setError(''); setNotice('');
    try { await persistTemplate(nextDesign); }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Could not save this template.'; setError(message); throw cause; }
    finally { setBusy(false); }
  }

  async function removeTemplate(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (editingId === id) clearForm(); await load(); setNotice('Template deleted.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete template.'); }
    finally { setBusy(false); }
  }

  async function duplicateTemplate(id: string, templateName: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/templates/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify({ name: `Copy of ${templateName}` }) });
      await load(); setNotice('Template duplicated as a new draft.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not duplicate template.'); }
    finally { setBusy(false); }
  }

  async function createFolderForControls(input: { name: string; parentId: string | null }) {
    const result = await api<{ data: TemplateFolder }>('/api/template-folders', { method: 'POST', body: JSON.stringify({ name: input.name, parent_id: input.parentId }) });
    await load();
    return { id: result.data.id, name: result.data.name, parentId: result.data.parent_id };
  }

  async function deleteFolderForControls(folderId: string) {
    await api(`/api/template-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
    await load();
  }

  async function moveTemplateForControls(input: { templateId: string; folderId: string | null }) {
    await api(`/api/templates/${encodeURIComponent(input.templateId)}/folder`, { method: 'PATCH', body: JSON.stringify({ folder_id: input.folderId }) });
    await load();
  }

  async function publishTemplate(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/templates/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' }); await load(); setNotice('Published version is now live for new sends.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish template.'); }
    finally { setBusy(false); }
  }

  async function showHistory(template: Template) {
    if (historyId === template.id) { setHistoryId(''); setHistory([]); return; }
    setHistoryId(template.id); setHistoryLoading(true); setHistory([]); setError('');
    try { const result = await api<{ data: TemplateVersion[] }>(`/api/templates/${encodeURIComponent(template.id)}/versions`); setHistory(result.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load version history.'); }
    finally { setHistoryLoading(false); }
  }

  const previewVariables = useMemo(() => {
    try {
      const parsed = JSON.parse(variablesJson) as Array<{ key?: unknown; fallback_value?: unknown; fallbackValue?: unknown }>;
      if (!Array.isArray(parsed)) return {};
      return Object.fromEntries(parsed.filter((item) => typeof item?.key === 'string').map((item) => [item.key as string, String(item.fallback_value ?? item.fallbackValue ?? `Sample ${item.key}`)]));
    } catch { return {}; }
  }, [variablesJson]);
  const previewHtml = useMemo(() => renderTemplatePreview(design ? renderEmailDesign(design) : html, previewVariables, true), [design, html, previewVariables]);
  const previewSubject = useMemo(() => renderTemplatePreview(subject, previewVariables, false), [subject, previewVariables]);
  const previewText = useMemo(() => renderTemplatePreview(text, previewVariables, false), [text, previewVariables]);
  const editorModel = design ? designToEditor(design) : null;
  const folderRows = useMemo(() => folders.map(({ id, name: folderName, parent_id }) => ({ id, name: folderName, parentId: parent_id })), [folders]);
  const templateRows = useMemo(() => templates.map((template) => ({
    id: template.id,
    name: template.name,
    subject: `${template.subject || 'No default subject'}${template.alias ? ` · ${template.alias}` : ''}`,
    folderId: template.folder_id ?? null,
    status: template.status === 'published' ? 'Published' as const : 'Draft' as const,
    updatedLabel: localTime(template.updated_at),
  })), [templates]);

  function renderTemplateActions(saved: SavedTemplate) {
    const template = templates.find((item) => item.id === saved.id);
    if (!template) return null;
    return <div className="resourceActions">
      <button className="outlineButton" onClick={() => void editTemplate(template)} disabled={busy}>Edit</button>
      <button className="outlineButton" onClick={() => void duplicateTemplate(template.id, template.name)} disabled={busy}>Duplicate</button>
      <button className="outlineButton" onClick={() => void showHistory(template)} aria-expanded={historyId === template.id} disabled={busy}>History</button>
      {(template.status === 'draft' || template.has_unpublished_versions) && <button className="primaryButton" onClick={() => void publishTemplate(template.id)} disabled={busy}>Publish</button>}
      <button className="dangerButton" onClick={() => void removeTemplate(template.id)} disabled={busy}>Delete</button>
    </div>;
  }

  function renderTemplateDetails(saved: SavedTemplate) {
    if (historyId !== saved.id) return null;
    return <div className="templateHistory" aria-live="polite">
      <h3>Version history</h3>
      {historyLoading ? <p>Loading versions…</p> : history.length ? history.map((version) => <article key={version.id} className="templateVersion">
        <div><strong>{version.is_published ? 'Live version' : version.is_current ? 'Current draft' : 'Draft version'}</strong><small>{localTime(version.created_at)}{version.published_at ? ` · published ${localTime(version.published_at)}` : ''}</small></div>
        <code>{version.id}</code><span>{version.subject || 'No default subject'}</span>
      </article>) : <p>No saved versions yet.</p>}
    </div>;
  }

  return <>
    {editorOpen && design && editorModel && <div className="templateEditorOverlay" role="dialog" aria-modal="true" aria-label="Visual email editor"><TemplatesEditor key="template-editor" templateName={name || 'Welcome email'} accountName="Website Thanks" lastSavedWords={editingId ? 'Draft saved' : 'Draft not saved yet'} initialBlocks={editorModel.blocks} initialTheme={editorModel.theme} onSave={saveVisualTemplate} onClose={() => setEditorOpen(false)} saveError={error} /></div>}
    <div className="pageHeading"><div><div className="eyebrow">REUSABLE CONTENT</div><h1>Templates</h1><p>Save drafts, preview variables, and publish a stable version for new sends.</p></div><button className="outlineButton" onClick={() => void load()}>Refresh</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}</div>}
    {notice && <div className="notice successNotice" role="status">{notice}</div>}
    <form className="resourceForm panel" onSubmit={saveTemplate}>
      <div className="panelHeader"><div><h2>{editingId ? 'Edit template' : 'New template'}</h2><p>Use placeholders like <code>{'{{{RECIPIENT_NAME}}}'}</code>. Draft edits stay separate until you publish.</p></div></div>
      <div className="resourceFields">
        <label>Template name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
        <label>Alias<input value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={120} placeholder="welcome-email" /></label>
        <label>Default from<input value={from} onChange={(event) => setFrom(event.target.value)} maxLength={320} placeholder="Team <hello@example.com>" /></label>
        <label>Default reply-to<input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} maxLength={320} placeholder="support@example.com" /></label>
        <label>Default subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={998} placeholder="Welcome, {{{RECIPIENT_NAME}}}" /></label>
        <label>Plain text<textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={100_000} placeholder="Hello {{{RECIPIENT_NAME}}}," /></label>
        <div className="templateEditorField">
          <div className="templateEditorMode" role="group" aria-label="Email editor mode">
            <button type="button" className={editorMode === 'visual' ? 'selected' : ''} onClick={() => { const next = design ?? createClaudeStarterDesign(); setDesign(next); setEditorMode('visual'); setEditorOpen(true); }}>Visual editor</button>
            <button type="button" className={editorMode === 'html' ? 'selected' : ''} onClick={() => { if (design) setHtml(renderEmailDesign(design)); setDesign(null); setEditorMode('html'); }}>HTML source</button>
          </div>
          <label>HTML<textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={7} maxLength={500_000} placeholder="<p>Hello {{{RECIPIENT_NAME}}},</p>" /></label>
          <EmailCompatibilityPanel html={design ? renderEmailDesign(design) : html} />
        </div>
        <label className="templateVariablesField">Variables (JSON)<textarea value={variablesJson} onChange={(event) => setVariablesJson(event.target.value)} rows={6} spellCheck={false} placeholder={'[{"key":"RECIPIENT_NAME","type":"string","fallback_value":"friend"}]'} /></label>
      </div>
      <div className="resourceFormActions"><button className="primaryButton" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save draft' : 'Create draft'}</button>{editingId && <button type="button" className="outlineButton" onClick={() => void publishTemplate(editingId)} disabled={busy}>Publish draft</button>}{editingId && <button type="button" className="outlineButton" onClick={clearForm} disabled={busy}>Cancel edit</button>}</div>
      <section className="templatePreview" aria-label="Template preview"><div className="templatePreviewHeader"><div><strong>Preview</strong><span>{previewSubject || 'Subject preview'}</span></div><small>Sample values use fallbacks</small></div><div className="templatePreviewBody"><iframe title="Sandboxed template HTML preview" sandbox="" srcDoc={safeEmailPreview(previewHtml)} />{previewText && <pre>{previewText}</pre>}</div></section>
    </form>
    <section className="panel resourceList">
      <TemplateFolderControls
        folders={folderRows}
        templates={templateRows}
        selectedFolderId={selectedFolderId || null}
        layout={isPhone ? 'mobile' : 'desktop'}
        disabled={busy}
        onSelectFolder={selectTemplateFolder}
        onCreateFolder={createFolderForControls}
        onMoveTemplate={moveTemplateForControls}
        onDeleteFolder={deleteFolderForControls}
        renderTemplateActions={renderTemplateActions}
        renderTemplateDetails={renderTemplateDetails}
      />
    </section>
  </>;
}

export function ContactsWorkspace({ preferencesConfigured }: { preferencesConfigured: boolean }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activityOpen, setActivityOpen] = useState('');
  const [contactActivity, setContactActivity] = useState<Record<string, ContactActivityState>>({});
  const [isPhone, setIsPhone] = useState(false);
  const [contactTab, setContactTab] = useState<'contacts' | 'properties'>('contacts');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentSource, setConsentSource] = useState('Website signup');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'skip' | 'upsert'>('skip');
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preferenceLinks, setPreferenceLinks] = useState<Record<string, string>>({});
  const [preferenceLoading, setPreferenceLoading] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [deleteContactsOpen, setDeleteContactsOpen] = useState(false);
  const [deleteContactsConfirmation, setDeleteContactsConfirmation] = useState('');

  const load = useCallback(async () => {
    try { const result = await api<{ data: Contact[] }>('/api/contacts'); setContacts(result.data); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load contacts.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 680px)');
    const sync = () => setIsPhone(media.matches);
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);


  const filteredContacts = useMemo(() => contacts.filter((contact) => `${contact.email} ${contact.name ?? ''} ${contact.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())), [contacts, search]);
  const contactSelectionTargets = filteredContacts.slice(0, 120);
  const allFilteredContactsSelected = contactSelectionTargets.length > 0 && contactSelectionTargets.every((contact) => selectedContactIds.includes(contact.id));

  async function loadActivity(contactId: string, after: string | null = null) {
    setContactActivity((current) => {
      const previous = current[contactId] ?? { items: [], hasMore: false, nextAfter: null, status: 'loading' as const, loadingMore: false, error: '', loadMoreError: '' };
      return { ...current, [contactId]: { ...previous, status: after && previous.items.length ? 'ready' : 'loading', loadingMore: Boolean(after), error: '', loadMoreError: '' } };
    });
    try {
      const query = new URLSearchParams({ limit: '30' });
      if (after) query.set('after', after);
      const result = await api<{ data: ContactActivityRow[]; has_more: boolean; next_after?: string }>('/api/contacts/' + encodeURIComponent(contactId) + '/activity?' + query);
      const rows = result.data.flatMap((row) => { const item = toContactActivityItem(row); return item ? [item] : []; });
      setContactActivity((current) => {
        const previous = current[contactId] ?? { items: [], hasMore: false, nextAfter: null, status: 'loading' as const, loadingMore: false, error: '', loadMoreError: '' };
        const items = after ? [...previous.items, ...rows.filter((item) => !previous.items.some((row) => row.id === item.id))] : rows;
        return { ...current, [contactId]: { items, hasMore: result.has_more, nextAfter: result.next_after ?? null, status: 'ready', loadingMore: false, error: '', loadMoreError: '' } };
      });
    } catch (cause) {
      setContactActivity((current) => {
        const previous = current[contactId] ?? { items: [], hasMore: false, nextAfter: null, status: 'loading' as const, loadingMore: false, error: '', loadMoreError: '' };
        const message = cause instanceof Error ? cause.message : 'Could not load contact activity.';
        return { ...current, [contactId]: after ? { ...previous, status: 'ready', loadingMore: false, loadMoreError: message } : { ...previous, status: 'error', loadingMore: false, error: message } };
      });
    }
  }

  function toggleActivity(contactId: string) {
    if (activityOpen === contactId) { setActivityOpen(''); return; }
    setActivityOpen(contactId);
    if (!contactActivity[contactId] || contactActivity[contactId].status === 'error') void loadActivity(contactId);
  }

  async function addContact(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/contacts', { method: 'POST', body: JSON.stringify({ email, name: name || null, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), consent_status: consentConfirmed ? 'opted_in' : 'unknown', ...(consentConfirmed ? { consent_source: consentSource } : {}) }) });
      setEmail(''); setName(''); setTags(''); setConsentConfirmed(false); await load(); setNotice('Contact added.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add contact.'); }
    finally { setBusy(false); }
  }

  async function unsubscribe(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/contacts/${encodeURIComponent(id)}/unsubscribe`, { method: 'POST', body: '{}' }); await load(); setNotice('Contact unsubscribed from future broadcasts.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not unsubscribe contact.'); }
    finally { setBusy(false); }
  }

  function updateContactSearch(value: string) {
    setSearch(value);
    setSelectedContactIds([]);
    setDeleteContactsOpen(false);
    setDeleteContactsConfirmation('');
  }

  function toggleContactSelection(id: string) {
    if (selectedContactIds.includes(id)) {
      setSelectedContactIds((current) => current.filter((selectedId) => selectedId !== id));
      setError('');
      return;
    }
    if (selectedContactIds.length >= 120) {
      setError('Bulk delete is limited to 120 contacts at a time.');
      return;
    }
    setSelectedContactIds((current) => [...current, id]);
    setError('');
  }

  function toggleVisibleContactSelection() {
    if (allFilteredContactsSelected) {
      setSelectedContactIds((current) => current.filter((id) => !contactSelectionTargets.some((contact) => contact.id === id)));
      return;
    }
    setSelectedContactIds(contactSelectionTargets.map((contact) => contact.id));
    setError('');
  }

  async function deleteSelectedContacts() {
    if (deleteContactsConfirmation !== 'DELETE CONTACTS' || selectedContactIds.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ deleted: number }>('/api/contacts', {
        method: 'DELETE',
        body: JSON.stringify({ ids: selectedContactIds, confirmation: 'DELETE CONTACTS' }),
      });
      setSelectedContactIds([]);
      setDeleteContactsOpen(false);
      setDeleteContactsConfirmation('');
      await load();
      setNotice(`${result.deleted} contact${result.deleted === 1 ? '' : 's'} deleted permanently.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete selected contacts.'); }
    finally { setBusy(false); }
  }

  async function loadPreferenceLink(id: string) {
    setPreferenceLoading(id); setError('');
    try { const result = await api<{ url: string }>(`/api/contacts/${encodeURIComponent(id)}/preferences`); setPreferenceLinks((current) => ({ ...current, [id]: result.url })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a preferences link.'); }
    finally { setPreferenceLoading(''); }
  }

  async function importContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csvFile) { setError('Choose a CSV file first.'); return; }
    setImportBusy(true); setError(''); setNotice(''); setImportResult('');
    const form = event.currentTarget;
    const body = new FormData();
    body.set('file', csvFile);
    body.set('mode', importMode);
    try {
      const response = await fetch('/api/contacts/import', { method: 'POST', body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error ?? `Import failed (${response.status})`);
      const counts = result?.counts ?? {};
      setImportResult(`${counts.created ?? 0} created, ${counts.updated ?? 0} updated, ${counts.skipped ?? 0} skipped.`);
      if (result?.errors?.length) setImportResult((current) => `${current} First issue: row ${result.errors[0].row}, ${result.errors[0].message}`);
      setCsvFile(null); form.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import contacts.'); }
    finally { setImportBusy(false); }
  }

  return <>
    <div className="pageHeading"><div><div className="eyebrow">AUDIENCE</div><h1>Contacts</h1><p>Contact records keep opt-in source and time separate from unsubscribe state.</p></div><button className="outlineButton" onClick={() => void load()}>Refresh</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}</div>}
    {notice && <div className="notice successNotice" role="status">{notice}</div>}
    <div className="contactTabs" role="tablist" aria-label="Contact workspace" onKeyDown={(event) => {
      if (event.key === 'ArrowRight' && contactTab === 'contacts') { event.preventDefault(); setContactTab('properties'); document.getElementById('contact-properties-tab')?.focus(); }
      if (event.key === 'ArrowLeft' && contactTab === 'properties') { event.preventDefault(); setContactTab('contacts'); document.getElementById('contacts-tab')?.focus(); }
    }}>
      <button type="button" role="tab" id="contacts-tab" aria-controls="contacts-panel" aria-selected={contactTab === 'contacts'} className={contactTab === 'contacts' ? 'active' : ''} onClick={() => setContactTab('contacts')}>Contacts</button>
      <button type="button" role="tab" id="contact-properties-tab" aria-controls="contact-properties-panel" aria-selected={contactTab === 'properties'} className={contactTab === 'properties' ? 'active' : ''} onClick={() => setContactTab('properties')}>Properties</button>
    </div>
    {contactTab === 'contacts' ? <div className="contactTabPanel" role="tabpanel" id="contacts-panel" aria-labelledby="contacts-tab">
    <form className="addForm panel contactForm" onSubmit={addContact}>
      <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="person@example.com" maxLength={254} required /></label>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Optional" /></label>
      <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="customer, updates" /></label>
      <label className="consentCheck"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /> I have permission to send this contact marketing email</label>
      {consentConfirmed && <label>Consent source<input value={consentSource} onChange={(event) => setConsentSource(event.target.value)} minLength={2} maxLength={200} required /></label>}
      <button className="primaryButton" disabled={busy}>{busy ? 'Saving…' : 'Add contact'}</button>
    </form>
    <section className="panel importPanel">
      <div className="panelHeader"><div><h2>Import or export</h2><p>Use CSV with an email column and optional consent_status, consent_source, consented_at, name, tags, unsubscribed and custom-property columns. Imports are limited to 2 MB.</p></div><a className="outlineButton" href="/api/contacts/export">Export contacts</a></div>
      <form className="contactImportForm" onSubmit={importContacts}>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)} required /></label>
        <label>Existing contacts<select value={importMode} onChange={(event) => setImportMode(event.target.value as 'skip' | 'upsert')}><option value="skip">Skip duplicates</option><option value="upsert">Update matching contacts</option></select></label>
        <button className="primaryButton" disabled={!csvFile || importBusy}>{importBusy ? 'Importing…' : 'Import CSV'}</button>
      </form>
      {importResult && <p className="importResult" role="status">{importResult}</p>}
    </section>
    <section className="panel resourceList">
      <div className="tableToolbar"><label className="searchBox"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => updateContactSearch(event.target.value)} placeholder="Search contacts" /></label><span className="recordCount">{filteredContacts.length} contacts</span></div>
      <div className="contactBulkToolbar">
        <label><input type="checkbox" checked={allFilteredContactsSelected} onChange={toggleVisibleContactSelection} disabled={!filteredContacts.length || busy} />{filteredContacts.length > 120 ? `Select first 120 of ${filteredContacts.length} matching` : `Select all ${filteredContacts.length} matching`}</label>
        <span className="recordCount" role="status" aria-live="polite">{selectedContactIds.length} selected</span>
        {selectedContactIds.length > 0 && <><button type="button" className="textButton" onClick={() => { setSelectedContactIds([]); setDeleteContactsOpen(false); setDeleteContactsConfirmation(''); }} disabled={busy}>Clear selection</button><button type="button" className="dangerButton" onClick={() => setDeleteContactsOpen(true)} disabled={busy}>Delete selected</button></>}
      </div>
      {deleteContactsOpen && <div className="contactDeleteConfirm" role="group" aria-labelledby="delete-contacts-title">
        <div><strong id="delete-contacts-title">Permanently delete {selectedContactIds.length} contact{selectedContactIds.length === 1 ? '' : 's'}?</strong><p>This cannot be undone. Type DELETE CONTACTS to confirm.</p></div>
        <label>Confirmation phrase<input value={deleteContactsConfirmation} onChange={(event) => setDeleteContactsConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></label>
        <div className="contactDeleteActions"><button type="button" className="dangerButton" onClick={() => void deleteSelectedContacts()} disabled={busy || deleteContactsConfirmation !== 'DELETE CONTACTS'}>{busy ? 'Deleting…' : 'Permanently delete'}</button><button type="button" className="textButton" onClick={() => { setDeleteContactsOpen(false); setDeleteContactsConfirmation(''); }} disabled={busy}>Cancel</button></div>
      </div>}
      {filteredContacts.length ? filteredContacts.map((contact) => <article className="resourceRow contactRow" key={contact.id}>
        <label className="contactSelectBox"><input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => toggleContactSelection(contact.id)} disabled={busy} aria-label={`Select ${contact.email}`} /></label>
        <div className="resourceMain"><strong>{contact.email}</strong><span>{contact.name || 'No name'}{contact.tags.length ? ` · ${contact.tags.join(', ')}` : ''}</span></div>
        <div className="resourceMeta"><span className={`plainStatus ${contact.unsubscribed_at ? 'failed' : contact.consent_status === 'opted_in' ? 'verified' : ''}`}>{contact.unsubscribed_at ? 'Unsubscribed' : contact.consent_status === 'opted_in' ? 'Opted in' : 'Consent unknown'}</span>{contact.consent_source && <small>Source: {contact.consent_source}</small>}{contact.consented_at && <small>Recorded {localTime(contact.consented_at)}</small>}</div>
        {preferencesConfigured && <div className="contactPreferenceAction">{preferenceLinks[contact.id] ? <a className="textButton" href={preferenceLinks[contact.id]} target="_blank" rel="noreferrer">Open preference center ↗</a> : <button className="textButton" onClick={() => void loadPreferenceLink(contact.id)} disabled={preferenceLoading === contact.id}>{preferenceLoading === contact.id ? 'Creating link…' : 'Preference link'}</button>}</div>}
        {!contact.unsubscribed_at && <button className="dangerButton" onClick={() => void unsubscribe(contact.id)} disabled={busy}>Unsubscribe</button>}
        <button className={'contactActivityToggle' + (activityOpen === contact.id ? ' selected' : '')} type="button" aria-expanded={activityOpen === contact.id} aria-controls={'contact-activity-' + contact.id} aria-haspopup={isPhone ? 'dialog' : undefined} onClick={() => toggleActivity(contact.id)}>{activityOpen === contact.id ? 'Hide activity' : 'Activity'}</button>
        {activityOpen === contact.id && contactActivity[contact.id] && <ContactActivityPanel
          panelId={'contact-activity-' + contact.id}
          variant={isPhone ? 'sheet' : 'inline'}
          contact={{ id: contact.id, email: contact.email, name: contact.name }}
          items={contactActivity[contact.id].items}
          status={contactActivity[contact.id].status}
          errorMessage={contactActivity[contact.id].error}
          hasMore={contactActivity[contact.id].hasMore}
          loadingMore={contactActivity[contact.id].loadingMore}
          loadMoreError={contactActivity[contact.id].loadMoreError}
          onLoadMore={() => loadActivity(contact.id, contactActivity[contact.id].nextAfter)}
          onRetry={() => loadActivity(contact.id)}
          onClose={() => setActivityOpen('')}
        />}
      </article>) : <div className="emptyPanel">No matching contacts. Add a contact to start building an audience.</div>}
    </section>
    </div> : <div className="contactTabPanel" role="tabpanel" id="contact-properties-panel" aria-labelledby="contact-properties-tab"><ContactPropertiesPanel /></div>}
  </>;
}

function ContactPropertiesPanel() {
  const [properties, setProperties] = useState<ContactProperty[]>([]);
  const [editingKey, setEditingKey] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<'string' | 'number'>('string');
  const [fallback, setFallback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { const result = await api<{ data: ContactProperty[] }>('/api/contact-properties'); setProperties(result.data); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load contact properties.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function beginEdit(property: ContactProperty) {
    setEditingKey(property.key); setKey(property.key); setType(property.type); setFallback(property.fallback_value === null ? '' : String(property.fallback_value)); setError(''); setNotice('');
  }

  function resetForm() { setEditingKey(''); setKey(''); setType('string'); setFallback(''); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    let fallbackValue: string | number | null = fallback === '' ? null : fallback;
    if (fallback !== '' && type === 'number') {
      const parsed = Number(fallback);
      if (!Number.isFinite(parsed)) { setError('Enter a finite number for this fallback.'); setBusy(false); return; }
      fallbackValue = parsed;
    }
    try {
      const body = { type, fallback_value: fallbackValue };
      if (editingKey) {
        await api(`/api/contact-properties/${encodeURIComponent(editingKey)}`, { method: 'PATCH', body: JSON.stringify(body) });
        setNotice(`${editingKey} was updated.`);
      } else {
        await api('/api/contact-properties', { method: 'POST', body: JSON.stringify({ key, ...body }) });
        setNotice(`${key} was added.`);
      }
      resetForm(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this property.'); }
    finally { setBusy(false); }
  }

  async function remove(property: ContactProperty) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/contact-properties/${encodeURIComponent(property.key)}`, { method: 'DELETE' }); setConfirmDelete(''); await load(); setNotice(`${property.key} was deleted. Values already stored on contacts were preserved.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this property.'); }
    finally { setBusy(false); }
  }

  return <section className="panel contactPropertiesPanel">
    <div className="panelHeader"><div><h2>Contact properties</h2><p>Define reusable string or number fields. Fallbacks are used by broadcasts only when a contact value is missing.</p></div><div className="contactPropertiesHeaderActions"><span className="recordCount">{properties.length} defined</span><button className="outlineButton" onClick={() => void load()}>Refresh</button></div></div>
    {error && <div className="notice errorNotice contactPropertyNotice" role="alert">{error}</div>}
    {notice && <div className="notice successNotice contactPropertyNotice" role="status">{notice}</div>}
    <form className="contactPropertyForm" onSubmit={(event) => void save(event)}>
      <label>Property key<input value={key} onChange={(event) => setKey(event.target.value)} disabled={Boolean(editingKey) || busy} placeholder="company_name" pattern="[A-Za-z_][A-Za-z0-9_.-]{0,99}" maxLength={100} required /></label>
      <label>Type<select value={type} onChange={(event) => setType(event.target.value as 'string' | 'number')} disabled={busy}><option value="string">String</option><option value="number">Number</option></select></label>
      <label>Fallback value{type === 'string' ? <textarea value={fallback} onChange={(event) => setFallback(event.target.value)} rows={2} maxLength={1000} placeholder="Optional" disabled={busy} /> : <input value={fallback} onChange={(event) => setFallback(event.target.value)} inputMode="decimal" placeholder="Optional number" disabled={busy} />}</label>
      <div className="contactPropertyFormActions"><button className="primaryButton" disabled={busy}>{busy ? 'Saving…' : editingKey ? 'Save changes' : 'Add property'}</button>{editingKey && <button type="button" className="outlineButton" onClick={resetForm} disabled={busy}>Cancel</button>}</div>
    </form>
    {properties.length ? <div className="contactPropertyRows">{properties.map((property) => <article className="contactPropertyRow" key={property.key}>
      <div className="contactPropertyIdentity"><strong>{property.key}</strong><span>{property.type}</span></div>
      <div className="contactPropertyFallback"><small>Fallback</small><code>{property.fallback_value === null ? 'None' : String(property.fallback_value)}</code></div>
      {confirmDelete === property.key ? <div className="contactPropertyConfirm" role="group" aria-label={`Delete ${property.key}`}><span>Delete the definition? Saved contact values stay in place.</span><button className="dangerButton" onClick={() => void remove(property)} disabled={busy}>{busy ? 'Deleting…' : 'Confirm delete'}</button><button className="textButton" onClick={() => setConfirmDelete('')} disabled={busy}>Keep</button></div> : <div className="contactPropertyActions"><button className="textButton" onClick={() => beginEdit(property)} disabled={busy}>Edit</button><button className="textButton" onClick={() => setConfirmDelete(property.key)} disabled={busy}>Delete</button></div>}
    </article>)}</div> : <div className="emptyPanel contactPropertyEmpty">No contact properties yet. Add a definition when you want consistent fields and broadcast fallbacks.</div>}
  </section>;
}

export function TopicsWorkspace() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { const result = await api<{ data: Topic[] }>('/api/topics'); setTopics(result.data); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load topics.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function editTopic(topic: Topic) { setEditingId(topic.id); setName(topic.name); setSlug(topic.slug); setDescription(topic.description ?? ''); setError(''); setNotice(''); }
  function clearForm() { setEditingId(''); setName(''); setSlug(''); setDescription(''); }
  async function saveTopic(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await api(editingId ? `/api/topics/${encodeURIComponent(editingId)}` : '/api/topics', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ name, ...(slug ? { slug } : {}), description: description || null }) });
      clearForm(); await load(); setNotice(editingId ? 'Topic updated.' : 'Topic created.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save topic.'); }
    finally { setBusy(false); }
  }
  async function archiveTopic(topic: Topic) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/topics/${encodeURIComponent(topic.id)}`, { method: 'DELETE' }); if (editingId === topic.id) clearForm(); await load(); setNotice('Topic archived. Existing preference history is retained.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive topic.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="pageHeading"><div><div className="eyebrow">AUDIENCE PREFERENCES</div><h1>Topics</h1><p>Let contacts choose which kinds of updates they want.</p></div><button className="outlineButton" onClick={() => void load()}>Refresh</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}</div>}
    {notice && <div className="notice successNotice" role="status">{notice}</div>}
    <form className="resourceForm panel topicForm" onSubmit={saveTopic}>
      <div className="panelHeader"><div><h2>{editingId ? 'Edit topic' : 'New topic'}</h2><p>Contact preferences are managed through the full access API. Global unsubscribes still suppress every topic.</p></div></div>
      <div className="topicFields"><label>Topic name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><label>Slug<input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} maxLength={80} placeholder="Updates automatically from the name" /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label></div>
      <div className="resourceFormActions"><button className="primaryButton" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create topic'}</button>{editingId && <button type="button" className="outlineButton" onClick={clearForm} disabled={busy}>Cancel edit</button>}</div>
    </form>
    <section className="panel resourceList"><div className="panelHeader"><div><h2>Active topics</h2><p>{topics.length} contact preference lists</p></div></div>
      {topics.length ? topics.map((topic) => <article className="resourceRow" key={topic.id}><div className="resourceMain"><strong>{topic.name}</strong><span>{topic.description || 'No description'} · {topic.subscribers_count.toLocaleString('en-AU')} opted-in contacts</span><code>{topic.slug} · {topic.id}</code></div><div className="resourceActions"><button className="outlineButton" onClick={() => editTopic(topic)}>Edit</button><button className="dangerButton" onClick={() => void archiveTopic(topic)} disabled={busy}>Archive</button></div></article>) : <div className="emptyPanel">No topics yet. Add preference lists such as product updates or monthly news.</div>}
    </section>
  </>;
}

export function BroadcastsWorkspace({ apiKeys, domains, canQueue }: { apiKeys: BroadcastKey[]; domains: BroadcastDomain[]; canQueue: boolean }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [folders, setFolders] = useState<CampaignFolderView[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [campaignQuery, setCampaignQuery] = useState('');
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatusFilter>('all');
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editingId, setEditingId] = useState('');
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('html');
  const [editorOpen, setEditorOpen] = useState(false);
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [draft, setDraft] = useState<BroadcastDraft>({ name: '', api_key_id: '', from: '', subject: '', reply_to: '', preview_text: '', text: '', html: '', design: null, audience_type: 'segment', audience_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metadataValidationAttempted, setMetadataValidationAttempted] = useState(false);
  const [metadataErrors, setMetadataErrors] = useState<Partial<Record<BroadcastMetadataField, string>>>({});

  const load = useCallback(async () => {
    setListStatus('loading');
    try {
      const [broadcastResult, segmentResult, topicResult, folderResult] = await Promise.all([
        api<{ data: Broadcast[] }>('/api/broadcasts'),
        api<{ data: Segment[] }>('/api/segments'),
        api<{ data: Topic[] }>('/api/topics'),
        api<{ data: Array<{ id: string; name: string; broadcast_count: number }> }>('/api/broadcast-folders'),
      ]);
      setBroadcasts(broadcastResult.data);
      setSegments(segmentResult.data);
      setTopics(topicResult.data);
      setFolders(folderResult.data.map((folder) => ({ id: folder.id, name: folder.name, campaignCount: folder.broadcast_count })));
      setListError('');
      setListStatus('ready');
      setError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load campaigns.';
      setError(message);
      setListError(message);
      setListStatus('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setDraft((current) => ({ ...current, api_key_id: current.api_key_id || apiKeys[0]?.id || '', from: current.from || (domains[0]?.domain ? `hello@${domains[0].domain}` : '') }));
  }, [apiKeys, domains]);

  const audienceOptions = draft.audience_type === 'segment' ? segments : topics;
  const keyDomain = domains.find((domain) => domain.domain === draft.from.split('@').at(-1)?.replace(/>$/, '').toLowerCase());
  const eligibleKeys = apiKeys.filter((key) => key.permission === 'full_access' || key.domain_id === keyDomain?.id);

  function update<K extends keyof BroadcastDraft>(key: K, value: BroadcastDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function metadataErrorsFor(value: BroadcastDraft = draft) {
    return { replyTo: validateReplyTo(value.reply_to), previewText: validatePreviewText(value.preview_text) };
  }
  function updateMetadata(field: BroadcastMetadataField, value: string) {
    const key = field === 'replyTo' ? 'reply_to' : 'preview_text';
    const nextDraft = { ...draft, [key]: value };
    update(key, value);
    if (!metadataValidationAttempted) return;
    const nextErrors = metadataErrorsFor(nextDraft);
    setMetadataErrors(nextErrors);
    if (!nextErrors.replyTo && !nextErrors.previewText) {
      setError((current) => current === BROADCAST_METADATA_VALIDATION_ERROR ? '' : current);
    }
  }
  function validateDraftMetadata() {
    setMetadataValidationAttempted(true);
    const nextErrors = metadataErrorsFor();
    setMetadataErrors(nextErrors);
    if (nextErrors.replyTo || nextErrors.previewText) {
      setError(BROADCAST_METADATA_VALIDATION_ERROR);
      if (!editorOpen) {
        const selector = nextErrors.replyTo ? '[name="reply_to"]' : '[name="preview_text"]';
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`.broadcastMetadata ${selector}`)?.focus());
      }
      return false;
    }
    setError((current) => current === BROADCAST_METADATA_VALIDATION_ERROR ? '' : current);
    return true;
  }
  function resetForm() {
    setEditingId('');
    setEditorMode('html');
    setScheduleLocal('');
    setMetadataValidationAttempted(false);
    setMetadataErrors({});
    setDraft({ name: '', api_key_id: apiKeys[0]?.id ?? '', from: domains[0]?.domain ? `hello@${domains[0].domain}` : '', subject: '', reply_to: '', preview_text: '', text: '', html: '', design: null, audience_type: 'segment', audience_id: '' });
  }
  function inputPayload(value: BroadcastDraft = draft) {
    return { name: value.name, api_key_id: value.api_key_id, from: value.from, subject: value.subject, reply_to: value.reply_to || null, preview_text: value.preview_text || null, ...(value.text ? { text: value.text } : {}), ...(value.html ? { html: value.html } : {}), design: value.design, audience_type: value.audience_type, audience_id: value.audience_id };
  }
  async function saveVisualBroadcast(blocks: Block[], theme: EmailTheme) {
    if (!validateDraftMetadata()) throw new Error(BROADCAST_METADATA_VALIDATION_ERROR);
    const nextDesign = editorToDesign(blocks, theme, draft.design ?? createClaudeStarterDesign());
    const nextDraft = { ...draft, design: nextDesign };
    setDraft(nextDraft);
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = editingId
        ? await api<{ id: string }>(`/api/broadcasts/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify(inputPayload(nextDraft)) })
        : await api<{ id: string }>('/api/broadcasts', { method: 'POST', body: JSON.stringify(inputPayload(nextDraft)) });
      setEditingId(saved.id);
      await load();
      setNotice('Draft saved.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save this draft.';
      setError(message);
      throw cause;
    } finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!validateDraftMetadata()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = editingId
        ? await api<{ id: string }>(`/api/broadcasts/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify(inputPayload()) })
        : await api<{ id: string }>('/api/broadcasts', { method: 'POST', body: JSON.stringify(inputPayload()) });
      setEditingId(saved.id);
      await load();
      setNotice('Draft saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this draft.'); }
    finally { setBusy(false); }
  }
  async function queueBroadcast(schedule = false) {
    if (!validateDraftMetadata()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = editingId
        ? await api<{ id: string }>(`/api/broadcasts/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify(inputPayload()) })
        : await api<{ id: string }>('/api/broadcasts', { method: 'POST', body: JSON.stringify(inputPayload()) });
      setEditingId(saved.id);
      const scheduledAt = schedule ? new Date(scheduleLocal).toISOString() : undefined;
      const result = await api<{ status: string; recipient_count: number }>(`/api/broadcasts/${encodeURIComponent(saved.id)}/send`, { method: 'POST', body: JSON.stringify(schedule ? { scheduled_at: scheduledAt } : {}) });
      setNotice(`${result.recipient_count} consented contacts queued. Status: ${result.status}.`);
      resetForm();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not queue the broadcast.'); }
    finally { setBusy(false); }
  }
  function editBroadcast(broadcast: Broadcast) {
    setEditingId(broadcast.id);
    setEditorMode(broadcast.design ? 'visual' : 'html');
    setScheduleLocal('');
    setMetadataValidationAttempted(false);
    setMetadataErrors({});
    setDraft({ name: broadcast.name, api_key_id: broadcast.api_key_id, from: broadcast.from_address, subject: broadcast.subject, reply_to: broadcast.reply_to ?? '', preview_text: broadcast.preview_text ?? '', text: broadcast.text_body ?? '', html: broadcast.html_body ?? '', design: broadcast.design ?? null, audience_type: broadcast.audience_type, audience_id: broadcast.audience_id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const broadcastEditorModel = draft.design ? designToEditor(draft.design) : null;
  async function cancelBroadcast(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ canceled_count: number }>(`/api/broadcasts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }); await load(); setNotice(`${result.canceled_count} pending messages canceled.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel the broadcast.'); }
    finally { setBusy(false); }
  }
  async function deleteDraft(id: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/broadcasts/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); setNotice('Draft deleted.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this draft.'); }
    finally { setBusy(false); }
  }
  const visibleCampaigns = useMemo(() => broadcasts.filter((broadcast) => {
    if (selectedFolderId && broadcast.folder_id !== selectedFolderId) return false;
    if (campaignStatus !== 'all' && broadcast.status !== campaignStatus) return false;
    const query = campaignQuery.trim().toLocaleLowerCase();
    return !query || broadcast.name.toLocaleLowerCase().includes(query) || broadcast.subject.toLocaleLowerCase().includes(query);
  }).map((broadcast) => ({
    id: broadcast.id,
    name: broadcast.name,
    subject: broadcast.subject,
    status: broadcast.status,
    folderId: broadcast.folder_id ?? null,
    statusAt: broadcast.scheduled_at && broadcast.status === 'scheduled' ? broadcast.scheduled_at : broadcast.updated_at || broadcast.created_at,
  })), [broadcasts, selectedFolderId, campaignQuery, campaignStatus]);
  async function createFolder(name: string) {
    const result = await api<{ data: { id: string; name: string; broadcast_count: number } }>('/api/broadcast-folders', { method: 'POST', body: JSON.stringify({ name }) });
    await load();
    return { id: result.data.id, name: result.data.name, campaignCount: result.data.broadcast_count };
  }
  async function renameFolder(id: string, name: string) {
    await api('/api/broadcast-folders/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ name }) });
    await load();
  }
  async function moveCampaign(id: string, folderId: string | null) {
    await api('/api/broadcasts/' + encodeURIComponent(id) + '/folder', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
    await load();
  }
  async function removeFolder(id: string) {
    await api('/api/broadcast-folders/' + encodeURIComponent(id), { method: 'DELETE' });
    await load();
  }

  return <>
    {editorOpen && draft.design && broadcastEditorModel && <div className="templateEditorOverlay" role="dialog" aria-modal="true" aria-label="Visual email editor"><TemplatesEditor key="broadcast-editor" templateName={draft.name || 'Broadcast draft'} accountName="Website Thanks" lastSavedWords={editingId ? 'Draft saved' : 'Draft not saved yet'} initialBlocks={broadcastEditorModel.blocks} initialTheme={broadcastEditorModel.theme} onSave={saveVisualBroadcast} onClose={() => setEditorOpen(false)} saveError={error} /></div>}
    <div className="pageHeading"><div><div className="eyebrow">CAMPAIGNS</div><h1>Broadcasts</h1><p>Send a consented topic or saved audience through the configured SMTP relay.</p></div><button className="outlineButton" onClick={() => void load()}>Refresh</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}</div>}{notice && <div className="notice successNotice" role="status">{notice}</div>}
    <form className="panel broadcastForm" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
      <div className="panelHeader"><div><h2>{editingId ? 'Edit draft' : 'Create a broadcast'}</h2><p>Only opted-in contacts without a global unsubscribe are queued. Maximum 1,000 recipients per send.</p></div></div>
      <div className="broadcastFields">
        <label>Broadcast name<input value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={120} placeholder="November product update" required /></label>
        <label>Sender<input value={draft.from} onChange={(event) => update('from', event.target.value)} placeholder="hello@example.com" required /></label>
        <label>API key<select value={draft.api_key_id} onChange={(event) => update('api_key_id', event.target.value)} required><option value="">Choose an active key</option>{eligibleKeys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}</select></label>
        <label className="broadcastSubject">Subject<input value={draft.subject} onChange={(event) => update('subject', event.target.value)} maxLength={998} required /></label>
        <BroadcastMetadataFields
          replyTo={draft.reply_to}
          previewText={draft.preview_text}
          onReplyToChange={(value) => updateMetadata('replyTo', value)}
          onPreviewTextChange={(value) => updateMetadata('previewText', value)}
          errors={metadataValidationAttempted ? metadataErrors : undefined}
          disabled={busy}
          className="broadcastMetadata"
        />
        <label>Audience type<select value={draft.audience_type} onChange={(event) => { const type = event.target.value as 'segment' | 'topic'; update('audience_type', type); update('audience_id', ''); }}><option value="segment">Saved segment</option><option value="topic">Subscribed topic</option></select></label>
        <label>{draft.audience_type === 'segment' ? 'Saved segment' : 'Subscribed topic'}<select value={draft.audience_id} onChange={(event) => update('audience_id', event.target.value)} required><option value="">Choose an audience</option>{audienceOptions.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select></label>
        <label>Text body<textarea value={draft.text} onChange={(event) => update('text', event.target.value)} maxLength={500000} rows={7} placeholder="Plain text content. {{FIRST_NAME|there}}, {{LAST_NAME}}, {{EMAIL}} and {{name}} are available." /></label>
        <div className="broadcastEditorField">
          <div className="templateEditorMode" role="group" aria-label="Email editor mode">
            <button type="button" className={editorMode === 'visual' ? 'selected' : ''} onClick={() => { if (!draft.design) update('design', createClaudeStarterDesign()); setEditorMode('visual'); setEditorOpen(true); }}>Visual editor</button>
            <button type="button" className={editorMode === 'html' ? 'selected' : ''} onClick={() => { if (draft.design) update('html', renderEmailDesign(draft.design)); update('design', null); setEditorMode('html'); }}>HTML source</button>
          </div>
          <label>HTML body<textarea value={draft.html} onChange={(event) => update('html', event.target.value)} maxLength={500000} rows={7} placeholder="Optional HTML. Use {{NAME}} for escaped values and {{{HTML}}} for trusted markup. Add |fallback inside a tag." /></label>
          <EmailCompatibilityPanel html={draft.design ? renderEmailDesign(draft.design) : draft.html} />
        </div>
        <div className="broadcastDisclosure">Each queued message gets a signed preference link and a List-Unsubscribe header. Message delivery starts from the scheduled worker. Opens and clicks are approximate metrics.</div>
        {error && <p className="inlineError" role="alert">{error}</p>}
        <div className="broadcastActions"><button className="outlineButton" type="submit" disabled={busy || !draft.api_key_id}>{busy ? 'Saving…' : 'Save draft'}</button><button className="primaryButton" type="button" disabled={busy || !canQueue || !draft.api_key_id || !draft.audience_id || (!draft.text && !draft.html && !draft.design)} onClick={() => void queueBroadcast(false)}>{busy ? 'Working…' : 'Queue now'}</button></div>
        <div className="broadcastSchedule"><label>Schedule time<input type="datetime-local" value={scheduleLocal} onChange={(event) => setScheduleLocal(event.target.value)} /></label><button className="outlineButton" type="button" disabled={busy || !canQueue || !scheduleLocal || !draft.api_key_id || !draft.audience_id || (!draft.text && !draft.html && !draft.design)} onClick={() => void queueBroadcast(true)}>Schedule broadcast</button><span className="muted">Future times must be within 30 days.</span></div>
        {!canQueue && <p className="keyMissing">Queueing needs SMTP, the scheduled worker and signed preference links to be configured.</p>}
      </div>
    </form>
    <BroadcastFoldersWorkspace
      folders={folders}
      campaigns={visibleCampaigns}
      totalCampaigns={broadcasts.length}
      selectedFolderId={selectedFolderId}
      query={campaignQuery}
      statusFilter={campaignStatus}
      listStatus={listStatus}
      listError={listError}
      onSelectFolder={setSelectedFolderId}
      onSearch={({ query, status }) => { setCampaignQuery(query); setCampaignStatus(status); }}
      onRetry={() => void load()}
      onCreateFolder={createFolder}
      onRenameFolder={renameFolder}
      onMoveCampaign={moveCampaign}
      onDeleteFolder={removeFolder}
      onEditCampaign={(id) => { const broadcast = broadcasts.find((item) => item.id === id); if (broadcast) editBroadcast(broadcast); }}
      onDeleteCampaign={(id) => void deleteDraft(id)}
      onCancelCampaign={(id) => void cancelBroadcast(id)}
    />
  </>;
}

function shortLabel(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
