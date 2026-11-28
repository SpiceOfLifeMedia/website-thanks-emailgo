'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AutomationRunRetry, { type Run as AutomationRun, type RunDetail as AutomationRunDetail, type RetryRequest } from './AutomationRunRetry';
import SendThanksAutomationCanvas, {
  CANVAS_KEY,
  insertStep,
  removeStep,
  type ActivationState,
  type AutomationConnection,
  type AutomationStep,
  type CanvasMeta,
  type SaveState,
  type StepType,
  type ValidationIssue,
} from './SendThanksAutomationCanvas';

type ApiKey = { id: string; name: string; permission: 'full_access' | 'sending_access'; prefix: string };
type Domain = { id: string; domain: string; verified_at: string | null };
type Template = { id: string; name: string; subject: string };
type Segment = { id: string; name: string; contacts_count: number };
type Automation = { id: string; api_key_id: string; key_name?: string; name: string; status: 'draft' | 'active' | 'paused'; trigger_event: string; steps: AutomationStep[]; connections: AutomationConnection[]; created_at: string; updated_at: string };
type AutomationDraft = {
  id: string;
  name: string;
  status: 'draft' | 'paused';
  steps: AutomationStep[];
  connections: AutomationConnection[];
  selectedKey: string | null;
  saveState: SaveState;
  savedAtLabel: string | null;
  issues: ValidationIssue[];
  activation: ActivationState;
};
type Run = AutomationRun;
type RunDetail = AutomationRunDetail | 'loading' | 'error';
type RunDetailResponse = {
  id: string; event_id: string; event_name: string; contact_id: string | null; email: string | null;
  status: string; started_at: string; updated_at: string; completed_at: string | null; error: string | null;
  event?: AutomationRunDetail['event']; contact?: AutomationRunDetail['contact']; step_order?: AutomationRunDetail['step_order'];
  steps: Array<{
    id: string; step_key: string; step_type: string; status: string; started_at: string; finished_at: string | null;
    error: string | null; input: unknown; output: unknown;
    attempts?: Array<{ id: string; attempt_number: number; status: string; error: string | null; started_at: string | null; finished_at: string | null; created_at: string }>;
  }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers }, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${response.status})`);
  return data as T;
}

function date(value: string) { return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

export function AutomationWorkspace({ apiKeys, domains }: { apiKeys: ApiKey[]; domains: Domain[] }) {
  const fullKeys = apiKeys.filter((key) => key.permission === 'full_access');
  const verifiedDomains = domains.filter((domain) => domain.verified_at);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState('Welcome sequence');
  const [eventName, setEventName] = useState('user.created');
  const [apiKeyId, setApiKeyId] = useState(fullKeys[0]?.id ?? '');
  const [templateId, setTemplateId] = useState('');
  const [domainId, setDomainId] = useState(verifiedDomains[0]?.id ?? '');
  const [delayMinutes, setDelayMinutes] = useState('');
  const [actionType, setActionType] = useState<'send_email' | 'contact_update' | 'add_to_segment' | 'event_only'>('send_email');
  const [segmentId, setSegmentId] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactTags, setContactTags] = useState('');
  const [openId, setOpenId] = useState('');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState('');
  const [canvasDraft, setCanvasDraft] = useState<AutomationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [automationResult, templateResult, segmentResult] = await Promise.all([
        api<{ data: Automation[] }>('/api/automations'),
        api<{ data: Template[] }>('/api/templates'),
        api<{ data: Segment[] }>('/api/segments'),
      ]);
      setAutomations(automationResult.data);
      setTemplates(templateResult.data);
      setSegments(segmentResult.data);
      if (!templateId && templateResult.data[0]) setTemplateId(templateResult.data[0].id);
      if (!segmentId && segmentResult.data[0]) setSegmentId(segmentResult.data[0].id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automation workspace.'); }
  }, [templateId, segmentId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!apiKeyId && fullKeys[0]) setApiKeyId(fullKeys[0].id); }, [apiKeyId, fullKeys]);
  useEffect(() => { if (!domainId && verifiedDomains[0]) setDomainId(verifiedDomains[0].id); }, [domainId, verifiedDomains]);

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId), [templateId, templates]);
  const selectedDomain = useMemo(() => verifiedDomains.find((domain) => domain.id === domainId), [domainId, verifiedDomains]);
  const selectedSegment = useMemo(() => segments.find((segment) => segment.id === segmentId), [segmentId, segments]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!apiKeyId || !eventName.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const trigger = { key: 'start', type: 'trigger', config: { event_name: eventName.trim() } };
      const steps: Array<{ key: string; type: string; config: Record<string, unknown> }> = [trigger];
      const connections: Array<{ from: string; to: string }> = [];
      let previous = 'start';
      if (actionType !== 'event_only' && delayMinutes.trim()) {
        const minutes = Number(delayMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) throw new Error('Delay must be between 1 and 43,200 minutes.');
        steps.push({ key: 'delay', type: 'delay', config: { duration: `${minutes} minutes` } });
        connections.push({ from: previous, to: 'delay' });
        previous = 'delay';
      }
      if (actionType === 'send_email') {
        if (!selectedTemplate || !selectedDomain) throw new Error('Choose an email template and verified sender domain.');
        steps.push({ key: 'send_action', type: 'send_email', config: { template: { id: selectedTemplate.id }, from: `hello@${selectedDomain.domain}` } });
        connections.push({ from: previous, to: 'send_action' });
      } else if (actionType === 'contact_update') {
        const updates: Record<string, unknown> = {};
        if (contactName.trim()) updates.name = contactName.trim();
        if (contactTags.trim()) updates.tags = [...new Set(contactTags.split(',').map((tag) => tag.trim()).filter(Boolean))];
        if (!Object.keys(updates).length) throw new Error('Enter a contact name or tag update.');
        steps.push({ key: 'contact_action', type: 'contact_update', config: { updates } });
        connections.push({ from: previous, to: 'contact_action' });
      } else if (actionType === 'add_to_segment') {
        if (!selectedSegment) throw new Error('Choose a saved segment.');
        steps.push({ key: 'segment_action', type: 'add_to_segment', config: { segment_id: selectedSegment.id } });
        connections.push({ from: previous, to: 'segment_action' });
      }
      await api('/api/automations', { method: 'POST', body: JSON.stringify({ api_key_id: apiKeyId, name: name.trim(), status: 'draft', steps, connections }) });
      setNotice('Automation draft created. Start it when the event and email path are ready.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create automation.'); }
    finally { setBusy(false); }
  }

  async function toggle(automation: Automation) {
    if (automation.status !== 'active' && !window.confirm(`Activate “${automation.name}”? New matching events will start runs using this workflow.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (automation.status === 'active') {
        await api(`/api/automations/${encodeURIComponent(automation.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
        setNotice('Automation paused. Existing runs continue.');
      } else {
        await api(`/api/automations/${encodeURIComponent(automation.id)}/start`, { method: 'POST', body: '{}' });
        setNotice('Automation started. New matching events will create runs.');
      }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update automation.'); }
    finally { setBusy(false); }
  }

  async function archive(automation: Automation) {
    if (!window.confirm(`Archive “${automation.name}”? Existing runs will continue and the definition will be retained.`)) return;
    setBusy(true); setError('');
    try { await api(`/api/automations/${encodeURIComponent(automation.id)}`, { method: 'DELETE' }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive automation.'); }
    finally { setBusy(false); }
  }

  function editWorkflow(automation: Automation) {
    setError(''); setNotice('');
    setEditingId(automation.id);
    setCanvasDraft({
      id: automation.id,
      name: automation.name,
      status: automation.status === 'paused' ? 'paused' : 'draft',
      steps: JSON.parse(JSON.stringify(automation.steps)) as AutomationStep[],
      connections: JSON.parse(JSON.stringify(automation.connections)) as AutomationConnection[],
      selectedKey: automation.steps.at(-1)?.key ?? null,
      saveState: 'saved',
      savedAtLabel: new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date(automation.updated_at)),
      issues: [],
      activation: 'idle',
    });
  }

  function defaultStep(type: StepType): AutomationStep {
    const key = `${type}_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    let config: Record<string, unknown> = {};
    if (type === 'condition') config = { field: 'contact.properties.plan', operator: 'eq', value: 'pro' };
    if (type === 'delay') config = { duration: '1 day' };
    if (type === 'wait_for_event') config = { event_name: 'user.completed', timeout: '3 days' };
    if (type === 'send_email') config = {
      template: { id: templates[0]?.id ?? '' },
      from: verifiedDomains[0] ? `hello@${verifiedDomains[0].domain}` : '',
    };
    if (type === 'contact_update') config = { updates: {} };
    if (type === 'add_to_segment') config = { segment_id: segments[0]?.id ?? '' };
    return { key, type, config };
  }

  function addCanvasStep(type: StepType, afterKey: string, branch?: 'true' | 'false') {
    if (!canvasDraft || canvasDraft.saveState === 'saving' || canvasDraft.activation !== 'idle') return;
    const step = defaultStep(type);
    const next = insertStep(canvasDraft.steps, canvasDraft.connections, step, afterKey, branch);
    setCanvasDraft({ ...canvasDraft, ...next, selectedKey: step.key, saveState: 'unsaved', issues: [], activation: 'idle' });
  }

  async function saveCanvasDraft() {
    if (!canvasDraft || canvasDraft.saveState === 'saving') return;
    setBusy(true); setError(''); setNotice('');
    setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, saveState: 'saving', issues: [] } : current);
    try {
      const saved = await api<Automation>(`/api/automations/${encodeURIComponent(canvasDraft.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: canvasDraft.name, steps: canvasDraft.steps, connections: canvasDraft.connections }),
      });
      setCanvasDraft(current => current?.id === canvasDraft.id ? {
        ...current,
        name: saved.name,
        status: saved.status === 'paused' ? 'paused' : 'draft',
        steps: saved.steps,
        connections: saved.connections,
        saveState: 'saved',
        savedAtLabel: new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date(saved.updated_at)),
        issues: [],
      } : current);
      setNotice('Workflow draft saved. Nothing has been activated.');
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save workflow draft.';
      setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, saveState: 'error', issues: [{ message }], activation: 'idle' } : current);
    }
    finally { setBusy(false); }
  }

  async function confirmCanvasActivation() {
    if (!canvasDraft || canvasDraft.saveState !== 'saved' || canvasDraft.issues.length) return;
    setBusy(true); setError(''); setNotice('');
    setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, activation: 'activating' } : current);
    try {
      await api(`/api/automations/${encodeURIComponent(canvasDraft.id)}/start`, { method: 'POST', body: '{}' });
      setEditingId(''); setCanvasDraft(null);
      setNotice('Automation activated. New matching events will create runs.');
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not activate automation.';
      setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, activation: 'idle', issues: [{ message }] } : current);
    } finally { setBusy(false); }
  }

  function closeCanvasEditor() {
    if (canvasDraft && canvasDraft.saveState !== 'saved' && canvasDraft.saveState !== 'saving' && !window.confirm('Discard the unsaved workflow changes?')) return;
    setEditingId('');
    setCanvasDraft(null);
  }

  async function showRuns(automation: Automation) {
    if (openId === automation.id) { setOpenId(''); setExpandedRunId(null); return; }
    setExpandedRunId(null);
    setOpenId(automation.id); setError('');
    try {
      const result = await api<{ data: Run[] }>(`/api/automations/${encodeURIComponent(automation.id)}/runs`);
      setRuns((current) => ({ ...current, [automation.id]: result.data }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automation runs.'); }
  }

  async function showRun(automation: Automation, run: Run) {
    setRunDetails((current) => ({ ...current, [run.id]: 'loading' }));
    try {
      const raw = await api<RunDetailResponse>(`/api/automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(run.id)}`);
      const steps = raw.steps.flatMap((step) => {
        const attempts = step.attempts?.length ? step.attempts : [{
          id: step.id,
          attempt_number: 1,
          status: step.status,
          error: step.error,
          started_at: step.started_at,
          finished_at: step.finished_at,
          created_at: step.started_at,
        }];
        return attempts.map((attempt) => ({
          id: attempt.id,
          step_key: step.step_key,
          step_type: step.step_type,
          status: attempt.status,
          started_at: attempt.started_at ?? attempt.created_at ?? step.started_at,
          finished_at: attempt.finished_at,
          error: attempt.error,
          input: step.input,
          output: step.output,
          attempt: attempt.attempt_number,
        }));
      });
      setRunDetails((current) => ({ ...current, [run.id]: {
        status: raw.status,
        steps,
        event: raw.event ?? { id: raw.event_id, name: raw.event_name, received_at: raw.started_at },
        contact: raw.contact ?? { id: raw.contact_id, email: raw.email },
        step_order: raw.step_order ?? automation.steps.filter((step) => step.type !== 'trigger').map((step) => ({ key: step.key, type: step.type })),
      } }));
    } catch (cause) {
      setRunDetails((current) => ({ ...current, [run.id]: 'error' }));
      setError(cause instanceof Error ? cause.message : 'Could not load run detail.');
    }
  }

  async function retryRun(automation: Automation, request: RetryRequest) {
    setRetryingRunId(request.runId); setError(''); setNotice('');
    try {
      await api(`/api/automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(request.runId)}/retry`, {
        method: 'POST', body: JSON.stringify({ confirm_send_retry: request.acknowledgedDuplicateRisk }),
      });
      const result = await api<{ data: Run[] }>(`/api/automations/${encodeURIComponent(automation.id)}/runs`);
      setRuns((current) => ({ ...current, [automation.id]: result.data }));
      setNotice(`Retry queued for ${request.stepKey}. Completed steps stay complete.`);
      const updatedRun = result.data.find((item) => item.id === request.runId);
      if (updatedRun) await showRun(automation, updatedRun);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not queue this retry.';
      setError(message);
      throw new Error(message);
    } finally { setRetryingRunId(null); }
  }

  async function stopRun(automation: Automation, run: Run) {
    setBusy(true); setError('');
    try {
      await api(`/api/automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(run.id)}/stop`, { method: 'POST', body: '{}' });
      const result = await api<{ data: Run[] }>(`/api/automations/${encodeURIComponent(automation.id)}/runs`);
      setRuns((current) => ({ ...current, [automation.id]: result.data }));
      await showRun(automation, result.data.find((item) => item.id === run.id) ?? run);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not stop run.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="pageHeading"><div><div className="eyebrow">LIFECYCLE MESSAGING</div><h1>Automations</h1><p>Trigger event driven workflows and inspect every run step.</p></div><button className="outlineButton" onClick={() => void refresh()} disabled={busy}>Refresh</button></div>
    {error && <p className="inlineError automationMessage" role="alert">{error}</p>}
    {notice && <p className="automationSuccess" role="status">{notice}</p>}
    <div className="automationLayout">
      <section className="panel automationCreate">
        <div className="panelHeader"><div><h2>Create an automation</h2><p>New workflows start as drafts and do not send until activated and triggered.</p></div></div>
        <form onSubmit={create}>
          <div className="automationFields">
            <label>Automation name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></label>
            <label>Full access API key<select value={apiKeyId} onChange={(event) => setApiKeyId(event.target.value)} required disabled={!fullKeys.length}><option value="">Select a full access key</option>{fullKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.prefix}</option>)}</select></label>
            <label>Trigger event<input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="user.created" required maxLength={150} /></label>
            <label>Next action<select value={actionType} onChange={(event) => setActionType(event.target.value as typeof actionType)}><option value="send_email">Send a template</option><option value="contact_update">Update contact</option><option value="add_to_segment">Add to segment</option><option value="event_only">Record event only</option></select></label>
            {actionType === 'send_email' && <>
              <label>Email template<select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required><option value="">Select template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.subject}</option>)}</select></label>
              <label>Verified sender domain<select value={domainId} onChange={(event) => setDomainId(event.target.value)} required disabled={!verifiedDomains.length}><option value="">Select domain</option>{verifiedDomains.map((domain) => <option key={domain.id} value={domain.id}>hello@{domain.domain}</option>)}</select></label>
              <label>Optional delay in minutes<input type="number" min="1" max="43200" value={delayMinutes} onChange={(event) => setDelayMinutes(event.target.value)} placeholder="Send right away" /></label>
            </>}
            {actionType === 'contact_update' && <>
              <label>Set contact name<input value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={120} placeholder="Leave blank to keep current name" /></label>
              <label>Replace contact tags<input value={contactTags} onChange={(event) => setContactTags(event.target.value)} placeholder="onboarded, trial-user" /></label>
              <label>Optional delay in minutes<input type="number" min="1" max="43200" value={delayMinutes} onChange={(event) => setDelayMinutes(event.target.value)} placeholder="Apply immediately" /></label>
            </>}
            {actionType === 'add_to_segment' && <>
              <label>Saved segment<select value={segmentId} onChange={(event) => setSegmentId(event.target.value)} required disabled={!segments.length}><option value="">Select segment</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name} · {segment.contacts_count} contacts</option>)}</select></label>
              <label>Optional delay in minutes<input type="number" min="1" max="43200" value={delayMinutes} onChange={(event) => setDelayMinutes(event.target.value)} placeholder="Add immediately" /></label>
            </>}
            {actionType === 'event_only' && <p className="automationHint">This records trigger events and run history without performing an action.</p>}
          </div>
          <div className="resourceFormActions"><button className="primaryButton" disabled={busy || !fullKeys.length || actionType === 'send_email' && (!selectedTemplate || !selectedDomain) || actionType === 'add_to_segment' && !selectedSegment}>{busy ? 'Saving…' : 'Create draft'}</button>{!fullKeys.length && <span className="keyMissing">Create a full access API key to manage automations.</span>}{actionType === 'send_email' && !verifiedDomains.length && <span className="automationHint">Email steps need a verified sender domain.</span>}</div>
        </form>
        <div className="securityNote">Automation email sends only to the contact or email attached to the event. Globally unsubscribed contacts are suppressed. The scheduled worker advances waits and delays.</div>
      </section>
      <section className="panel automationGuide">
        <div className="panelHeader"><div><h2>Send a trigger event</h2><p>Use your full access API key to start a matching workflow.</p></div></div>
        <pre><code>{`curl -X POST "$EMAILGO_URL/api/v1/events" \\
  -H "Authorization: Bearer $EMAILGO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: user-created-123" \\
  -d '{"event":"${eventName || 'user.created'}","email":"person@example.com","payload":{"plan":"pro"}}'`}</code></pre>
        <div className="automationHint">The event and workflow must use the same API key scope. Configure the worker for delays, wait steps and email actions.</div>
      </section>
    </div>
    <section className="panel automationList">
      <div className="panelHeader"><div><h2>Workflow definitions</h2><p>{automations.length} automations · active definitions cannot be edited.</p></div></div>
      {automations.length ? automations.map((automation) => <article className="automationRow" key={automation.id}>
        <div className="automationRowTop"><div className="automationMain"><strong>{automation.name}</strong><span>{automation.trigger_event} · {automation.steps.length} steps · {automation.key_name}</span><code>{automation.id} · updated {date(automation.updated_at)}</code></div><span className={`plainStatus ${automation.status === 'active' ? 'verified' : ''}`}>{automation.status}</span></div>
        <div className="automationActions"><button className="outlineButton" onClick={() => void showRuns(automation)}>{openId === automation.id ? 'Hide runs' : 'View runs'}</button><button className="outlineButton" onClick={() => void toggle(automation)} disabled={busy}>{automation.status === 'active' ? 'Pause' : 'Start'}</button><button className="outlineButton" onClick={() => editingId === automation.id ? closeCanvasEditor() : editWorkflow(automation)} disabled={busy || automation.status === 'active'}>{editingId === automation.id ? 'Close editor' : 'Edit workflow'}</button><button className="dangerButton" onClick={() => void archive(automation)} disabled={busy}>Archive</button></div>
        {editingId === automation.id && canvasDraft?.id === automation.id && <div className="automationEditor">
          <SendThanksAutomationCanvas
            key={canvasDraft.id}
            name={canvasDraft.name}
            status={canvasDraft.status}
            steps={canvasDraft.steps}
            connections={canvasDraft.connections}
            selectedKey={canvasDraft.selectedKey}
            saveState={canvasDraft.saveState}
            savedAtLabel={canvasDraft.savedAtLabel}
            issues={canvasDraft.issues}
            activation={canvasDraft.activation}
            positionsPersist={true}
            onNameChange={(name) => setCanvasDraft(current => current ? { ...current, name, saveState: 'unsaved', issues: [], activation: 'idle' } : current)}
            onSelect={(key) => setCanvasDraft(current => current ? { ...current, selectedKey: key } : current)}
            onAddStep={addCanvasStep}
            onRemoveStep={(key) => {
              const next = removeStep(canvasDraft.steps, canvasDraft.connections, key);
              setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, ...next, selectedKey: next.steps[0]?.key ?? null, saveState: 'unsaved', issues: [], activation: 'idle' } : current);
            }}
            onConfigChange={(key, config) => setCanvasDraft(current => current?.id === canvasDraft.id ? {
              ...current,
              steps: current.steps.map(step => step.key === key ? { ...step, config } : step),
              saveState: 'unsaved', issues: [], activation: 'idle',
            } : current)}
            onConnectionsChange={(connections) => setCanvasDraft(current => current?.id === canvasDraft.id ? { ...current, connections, saveState: 'unsaved', issues: [], activation: 'idle' } : current)}
            onPositionChange={(key, meta: CanvasMeta) => setCanvasDraft(current => {
              if (current?.id !== canvasDraft.id) return current;
              return {
                ...current,
                steps: current.steps.map(step => {
                  if (step.key !== key) return step;
                  const config = { ...step.config };
                  if (Object.keys(meta).length) config[CANVAS_KEY] = meta;
                  else delete config[CANVAS_KEY];
                  return { ...step, config };
                }),
                saveState: 'unsaved', issues: [], activation: 'idle',
              };
            })}
            onSaveDraft={() => void saveCanvasDraft()}
            onRequestActivate={() => setCanvasDraft(current => current?.saveState === 'saved' && !current.issues.length ? { ...current, activation: 'confirming' } : current)}
            onConfirmActivate={() => void confirmCanvasActivation()}
            onCancelActivate={() => setCanvasDraft(current => current ? { ...current, activation: 'idle' } : current)}
          />
        </div>}
        {openId === automation.id && <div className="automationRuns">
          <AutomationRunRetry
            automationName={automation.name}
            runs={runs[automation.id] ?? []}
            details={runDetails}
            expandedRunId={expandedRunId}
            onToggleRun={(run) => {
              const next = expandedRunId === run.id ? null : run.id;
              setExpandedRunId(next);
              if (next) void showRun(automation, run);
            }}
            onStopRun={(run) => stopRun(automation, run)}
            onRetryFailedStep={(request) => retryRun(automation, request)}
            busyRunId={retryingRunId ?? (busy ? expandedRunId : null)}
            formatDate={date}
          />
        </div>}
      </article>) : <div className="emptyPanel">No automations yet. Create a draft, then start it to accept matching events.</div>}
    </section>
  </>;
}
