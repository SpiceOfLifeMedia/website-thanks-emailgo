'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type ApiKey = { id: string; name: string; permission: 'full_access' | 'sending_access'; prefix: string };
type Domain = { id: string; domain: string; verified_at: string | null };
type Template = { id: string; name: string; subject: string };
type Segment = { id: string; name: string; contacts_count: number };
type Automation = { id: string; api_key_id: string; key_name?: string; name: string; status: string; trigger_event: string; steps: Array<{ key: string; type: string; config: Record<string, unknown> }>; connections: Array<{ from: string; to: string; condition?: string }>; created_at: string; updated_at: string };
type Run = { id: string; event_name: string; contact_id: string | null; email: string | null; status: string; current_step_key: string | null; started_at: string; completed_at: string | null; error: string | null };
type RunDetail = Record<string, unknown> & { status: string; steps: Array<{ id: string; step_key: string; step_type: string; status: string; started_at: string; finished_at: string | null; error: string | null; input: unknown; output: unknown }> };

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
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [runDetails, setRunDetails] = useState<Record<string, RunDetail>>({});
  const [editingId, setEditingId] = useState('');
  const [workflowJson, setWorkflowJson] = useState('');
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
    setWorkflowJson(JSON.stringify({ name: automation.name, steps: automation.steps, connections: automation.connections }, null, 2));
  }

  async function saveWorkflow(automation: Automation) {
    setBusy(true); setError(''); setNotice('');
    try {
      const definition = JSON.parse(workflowJson) as unknown;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('Workflow definition must be a JSON object.');
      await api(`/api/automations/${encodeURIComponent(automation.id)}`, { method: 'PATCH', body: JSON.stringify(definition) });
      setEditingId(''); setWorkflowJson(''); setNotice('Workflow saved. Start it when the definition is ready.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save workflow.'); }
    finally { setBusy(false); }
  }

  async function showRuns(automation: Automation) {
    if (openId === automation.id) { setOpenId(''); return; }
    setOpenId(automation.id); setError('');
    try {
      const result = await api<{ data: Run[] }>(`/api/automations/${encodeURIComponent(automation.id)}/runs`);
      setRuns((current) => ({ ...current, [automation.id]: result.data }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automation runs.'); }
  }

  async function showRun(automation: Automation, run: Run) {
    try {
      const detail = await api<RunDetail>(`/api/automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(run.id)}`);
      setRunDetails((current) => ({ ...current, [run.id]: detail }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load run detail.'); }
  }

  async function stopRun(automation: Automation, run: Run) {
    setBusy(true); setError('');
    try {
      await api(`/api/automations/${encodeURIComponent(automation.id)}/runs/${encodeURIComponent(run.id)}/stop`, { method: 'POST', body: '{}' });
      const result = await api<{ data: Run[] }>(`/api/automations/${encodeURIComponent(automation.id)}/runs`);
      setRuns((current) => ({ ...current, [automation.id]: result.data }));
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
        <div className="automationActions"><button className="outlineButton" onClick={() => void showRuns(automation)}>{openId === automation.id ? 'Hide runs' : 'View runs'}</button><button className="outlineButton" onClick={() => void toggle(automation)} disabled={busy}>{automation.status === 'active' ? 'Pause' : 'Start'}</button><button className="outlineButton" onClick={() => editingId === automation.id ? setEditingId('') : editWorkflow(automation)} disabled={busy || automation.status === 'active'}>{editingId === automation.id ? 'Close editor' : 'Edit workflow'}</button><button className="dangerButton" onClick={() => void archive(automation)} disabled={busy}>Archive</button></div>
        {editingId === automation.id && <div className="automationEditor"><label htmlFor={`workflow-json-${automation.id}`}>Workflow definition JSON <span>Conditions, waits and advanced steps can be edited here. Pause active workflows before editing.</span></label><textarea id={`workflow-json-${automation.id}`} value={workflowJson} onChange={(event) => setWorkflowJson(event.target.value)} rows={16} spellCheck={false} aria-describedby={`workflow-help-${automation.id}`} /><div className="automationEditorActions"><p id={`workflow-help-${automation.id}`}>Keep the trigger step first, connect every step, and use unique step keys. Save validates the graph before changing the definition.</p><button className="primaryButton" onClick={() => void saveWorkflow(automation)} disabled={busy}>{busy ? 'Saving…' : 'Save workflow'}</button></div></div>}
        {openId === automation.id && <div className="automationRuns">{runs[automation.id]?.length ? runs[automation.id].map((run) => <div className="automationRun" key={run.id}>
          <div className="automationRunSummary"><button className="textButton" onClick={() => void showRun(automation, run)}>{run.event_name} · {run.email ?? run.contact_id ?? 'No contact'}</button><span className={`plainStatus ${run.status === 'completed' ? 'verified' : run.status === 'failed' ? 'failed' : ''}`}>{run.status}</span><time>{date(run.started_at)}</time>{['running','waiting'].includes(run.status) && <button className="textButton" onClick={() => void stopRun(automation, run)} disabled={busy}>Stop run</button>}</div>
          {run.error && <p className="failureReason automationRunError">{run.error}</p>}
          {runDetails[run.id] && <div className="automationStepHistory">{runDetails[run.id].steps.map((step) => <div className="automationStep" key={step.id}><strong>{step.step_key}</strong><span>{step.step_type}</span><span className={`plainStatus ${step.status === 'completed' ? 'verified' : step.status === 'failed' ? 'failed' : ''}`}>{step.status}</span>{step.error && <small>{step.error}</small>}<details><summary>Step data</summary><pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre></details></div>)}</div>}
        </div>) : <div className="emptyPanel">No runs recorded for this automation.</div>}</div>}
      </article>) : <div className="emptyPanel">No automations yet. Create a draft, then start it to accept matching events.</div>}
    </section>
  </>;
}
