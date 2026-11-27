'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type ApiKey = { id: string; name: string; prefix: string };
type Webhook = { id: string; api_key_id: string; key_name: string; endpoint: string; events: string[]; created_at: string; updated_at: string; active: boolean };
type Attempt = { attempt_number: number; attempted_at: string; duration_ms: number; status_code: number | null; response_excerpt: string | null; error_message: string | null };
type Delivery = { id: string; event_id: string; event_type: string; status: string; attempt_count: number; created_at: string; last_attempt_at: string | null; last_status_code: number | null; last_error: string | null; delivered_at: string | null; attempts: Attempt[] };
const eventTypes = ['email.sent', 'email.failed', 'email.suppressed', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked', 'email.received', 'contact.created', 'contact.updated', 'contact.deleted', 'contact.subscribed', 'contact.unsubscribed', 'suppression.added', 'suppression.removed'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `Request failed (${response.status})`);
  return data as T;
}
function date(value: string) { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value)); }

export function WebhooksWorkspace({ apiKeys, signingConfigured }: { apiKeys: ApiKey[]; signingConfigured: boolean }) {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [apiKeyId, setApiKeyId] = useState(apiKeys[0]?.id ?? '');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['email.sent', 'email.failed']);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [openId, setOpenId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try { const result = await api<{ data: Webhook[] }>('/api/webhooks'); setHooks(result.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load webhooks.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!apiKeyId && apiKeys[0]) setApiKeyId(apiKeys[0].id); }, [apiKeyId, apiKeys]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ secret: string }>('/api/webhooks', { method: 'POST', body: JSON.stringify({ api_key_id: apiKeyId, endpoint, events: selectedEvents }) });
      setSecret(result.secret); setEndpoint(''); setNotice('Webhook created. Copy its signing secret now.'); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create webhook.'); }
    finally { setBusy(false); }
  }

  async function remove(hook: Webhook) {
    if (!window.confirm(`Disable webhook at ${hook.endpoint}? New events will stop being delivered.`)) return;
    setBusy(true); setError('');
    try { await api(`/api/webhooks/${encodeURIComponent(hook.id)}`, { method: 'DELETE' }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not disable webhook.'); }
    finally { setBusy(false); }
  }

  async function showDeliveries(hook: Webhook) {
    if (openId === hook.id) { setOpenId(''); return; }
    setOpenId(hook.id);
    try { const result = await api<{ data: Delivery[] }>(`/api/webhooks/${encodeURIComponent(hook.id)}/deliveries`); setDeliveries((current) => ({ ...current, [hook.id]: result.data })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load delivery history.'); }
  }

  async function replay(hook: Webhook, delivery: Delivery) {
    setBusy(true); setError('');
    try {
      await api(`/api/webhooks/${encodeURIComponent(hook.id)}/deliveries/${encodeURIComponent(delivery.id)}/replay`, { method: 'POST' });
      setDeliveries((current) => ({ ...current, [hook.id]: current[hook.id].map((item) => item.id === delivery.id ? { ...item, status: 'pending', attempt_count: 0, last_error: null } : item) }));
      setNotice('Delivery queued for replay.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not replay webhook.'); }
    finally { setBusy(false); }
  }

  async function rotate(hook: Webhook) {
    if (!window.confirm('Rotate this webhook secret? Your receiver must be updated before the next event is delivered.')) return;
    setBusy(true); setError('');
    try { const result = await api<{ secret: string }>(`/api/webhooks/${encodeURIComponent(hook.id)}/rotate-secret`, { method: 'POST' }); setSecret(result.secret); setNotice('Webhook secret rotated. Copy the new secret now.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rotate webhook secret.'); }
    finally { setBusy(false); }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(secret); setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  return <>
    <div className="pageHeading"><div><div className="eyebrow">EVENT DELIVERY</div><h1>Webhooks</h1><p>Send signed event notifications to your applications, with retry history and replay.</p></div><button className="outlineButton" onClick={() => void refresh()}>Refresh</button></div>
    {error && <div className="notice errorNotice" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
    {notice && <div className="notice successNotice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    {secret && <section className="webhookSecret" tabIndex={-1}><div><strong>Save this signing secret</strong><p>It is shown only once. Use it to verify the Svix-style signature headers.</p></div><code>{secret}</code><div className="resourceActions"><button className="outlineButton" onClick={() => void copySecret()}>{copied ? 'Copied' : 'Copy secret'}</button><span className="srOnly" role="status" aria-live="polite">{copied ? 'Signing secret copied.' : ''}</span><button className="textButton" onClick={() => setSecret('')}>Dismiss</button></div></section>}
    <form className="panel webhookForm" onSubmit={create}>
      <div className="panelHeader"><div><h2>Add endpoint</h2><p>Endpoints must use HTTPS. Private network addresses are blocked at delivery time.</p></div><span className={`plainStatus ${signingConfigured ? 'verified' : ''}`}>{signingConfigured ? 'Signing ready' : 'Signing secret needed'}</span></div>
      {!signingConfigured && <p className="webhookWarning">Set EMAILGO_WEBHOOK_SECRET in the server environment before creating endpoints.</p>}
      <div className="webhookFormFields"><label>Endpoint URL<input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com/send-thanks-events" required /></label><label>API key scope<select value={apiKeyId} onChange={(event) => setApiKeyId(event.target.value)} required disabled={!apiKeys.length}>{apiKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.prefix}</option>)}</select></label></div>
      {!apiKeys.length && <p className="webhookWarning">Create an active API key first. Webhook events are scoped to one API key.</p>}
      <fieldset className="webhookEvents"><legend>Events</legend>{eventTypes.map((type) => <label key={type}><input type="checkbox" checked={selectedEvents.includes(type)} onChange={(event) => setSelectedEvents((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))} />{type}</label>)}</fieldset>
      <div className="resourceFormActions"><button className="primaryButton" disabled={busy || !signingConfigured || !apiKeys.length || !selectedEvents.length}>{busy ? 'Saving…' : 'Create webhook'}</button></div>
    </form>
    <section className="panel webhookList"><div className="panelHeader"><div><h2>Configured endpoints</h2><p>{hooks.filter((hook) => hook.active).length} active · Delivery attempts run through the scheduled worker.</p></div></div>
      {hooks.length ? hooks.map((hook) => <article className="webhookRow" key={hook.id}><div className="webhookTop"><div className="resourceMain"><strong>{hook.endpoint}</strong><span>{hook.key_name} · {hook.events.join(', ')}</span><code>{hook.id} · added {date(hook.created_at)}</code></div><span className={`plainStatus ${hook.active ? 'verified' : ''}`}>{hook.active ? 'Active' : 'Disabled'}</span></div>
        <div className="webhookActions"><button className="outlineButton" onClick={() => void showDeliveries(hook)}>{openId === hook.id ? 'Hide deliveries' : 'Delivery history'}</button>{hook.active && <><button className="outlineButton" onClick={() => void rotate(hook)} disabled={busy}>Rotate secret</button><button className="dangerButton" onClick={() => void remove(hook)} disabled={busy}>Disable</button></>}</div>
        {openId === hook.id && <div className="deliveryList">{deliveries[hook.id]?.length ? deliveries[hook.id].map((delivery) => <div className="deliveryRow" key={delivery.id}><div><strong>{delivery.event_type}</strong><small>{date(delivery.created_at)} · {delivery.attempt_count} attempts{delivery.last_status_code ? ` · HTTP ${delivery.last_status_code}` : ''}</small>{delivery.last_error && <small className="failureReason">{delivery.last_error}</small>}<details className="attemptDetails"><summary>Attempt log, {delivery.attempts?.length ?? 0}</summary>{delivery.attempts?.map((attempt) => <div className="attemptRow" key={`${delivery.id}-${attempt.attempt_number}-${attempt.attempted_at}`}><span>Attempt {attempt.attempt_number}</span><span>{date(attempt.attempted_at)}</span><span>{attempt.duration_ms} ms{attempt.status_code ? ` · HTTP ${attempt.status_code}` : ''}</span>{attempt.error_message && <span className="failureReason">{attempt.error_message}</span>}{attempt.response_excerpt && <code>{attempt.response_excerpt}</code>}</div>)}</details></div><span className={`plainStatus ${delivery.status === 'delivered' ? 'verified' : delivery.status === 'failed' ? 'failed' : ''}`}>{delivery.status}</span>{['failed','delivered'].includes(delivery.status) && hook.active && <button className="textButton" onClick={() => void replay(hook, delivery)} disabled={busy}>Replay</button>}</div>) : <div className="emptyPanel">No event deliveries recorded for this endpoint yet.</div>}</div>}
      </article>) : <div className="emptyPanel">No webhook endpoints. Add an HTTPS endpoint to receive event notifications.</div>}
    </section>
    <section className="panel webhookNotes"><div className="panelHeader"><div><h2>Delivery behavior</h2><p>Current Send, thanks webhook contract.</p></div></div><div className="securityNote">Send, thanks signs the exact JSON body with HMAC SHA-256 and sends <code>svix-id</code>, <code>svix-timestamp</code>, and <code>svix-signature</code> headers. Failed deliveries retry up to five total attempts with increasing delays. Payloads stay available for retries, and receiver responses are retained as bounded excerpts in attempt history. The scheduled worker must run for delivery and retries to progress.</div></section>
  </>;
}
