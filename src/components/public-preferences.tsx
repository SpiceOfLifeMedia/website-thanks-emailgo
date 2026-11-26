'use client';

import { useCallback, useEffect, useState } from 'react';

type PreferenceData = { contact: { email: string; name: string | null; unsubscribed: boolean; consent_status: string }; topics: Array<{ id: string; name: string; description: string | null; subscribed: boolean }> };

export function PublicPreferences({ token }: { token: string }) {
  const [data, setData] = useState<PreferenceData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmResubscribe, setConfirmResubscribe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/preferences/${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error ?? 'This preference link is no longer available.');
      const next = result as PreferenceData;
      setData(next);
      setSelected(next.topics.filter((topic) => topic.subscribed).map((topic) => topic.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load preferences.'); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  async function save(globalUnsubscribe = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic_ids: selected, ...(globalUnsubscribe ? { global_unsubscribe: true } : {}), ...(confirmResubscribe ? { confirm_resubscribe: true } : {}) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error ?? 'Could not save preferences.');
      if (globalUnsubscribe) setNotice('You have been unsubscribed from all email topics.');
      else setNotice('Your email preferences have been saved.');
      setConfirmResubscribe(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save preferences.'); }
    finally { setBusy(false); }
  }

  return <><meta name="referrer" content="no-referrer" /><main className="publicPreferencesShell">
    <section className="publicPreferencesCard">
      <a className="wordmark" href="/"><span className="mark">e</span><span>Send, thanks<small>EMAIL DELIVERY</small></span></a>
      {loading ? <p className="publicPreferencesMessage">Loading your preferences…</p> : error && !data ? <div className="publicPreferencesMessage" role="alert">{error}</div> : data && <>
        <div className="eyebrow">EMAIL PREFERENCES</div>
        <h1>Choose what you receive</h1>
        <p className="publicPreferencesLead">Manage email preferences for <strong>{data.contact.email}</strong>.</p>
        {data.contact.unsubscribed && <div className="preferenceWarning">This address is currently unsubscribed. Select one or more topics and confirm below to opt in again.</div>}
        {error && <p className="inlineError" role="alert">{error}</p>}
        {notice && <p className="preferenceSuccess" role="status">{notice}</p>}
        <div className="publicTopicList">{data.topics.length ? data.topics.map((topic) => <label className="publicTopic" key={topic.id}><input type="checkbox" checked={selected.includes(topic.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, topic.id] : current.filter((id) => id !== topic.id))} /><span><strong>{topic.name}</strong>{topic.description && <small>{topic.description}</small>}</span></label>) : <p>No email topics are available right now.</p>}</div>
        {data.contact.unsubscribed && selected.length > 0 && <label className="resubscribeConfirm"><input type="checkbox" checked={confirmResubscribe} onChange={(event) => setConfirmResubscribe(event.target.checked)} /> I want to opt in to the selected email topics again.</label>}
        <button className="primaryButton" disabled={busy || (data.contact.unsubscribed && selected.length > 0 && !confirmResubscribe)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save preferences'}</button>
        {!data.contact.unsubscribed && <button className="publicUnsubscribeButton" disabled={busy} onClick={() => void save(true)}>Unsubscribe from all email</button>}
        <p className="publicPreferencesFootnote">Your choices update the preferences for this email address. You can return to this page using this link.</p>
      </>}
    </section>
  </main></>;
}
