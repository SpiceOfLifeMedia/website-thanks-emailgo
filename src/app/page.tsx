'use client';

import { useEffect, useMemo, useState } from 'react';

type Email = { id: string; to: string[]; from: string; subject: string; created_at: string; last_event: string };
const demo: Email[] = [
  { id: 'demo_1', to: ['maya@sample.com'], from: 'Website Thanks <hello@websitethanks.com>', subject: 'Your website is ready to review', created_at: new Date(Date.now() - 1000 * 60 * 17).toISOString(), last_event: 'bounced' },
  { id: 'demo_2', to: ['james@sample.com'], from: 'Website Thanks <hello@websitethanks.com>', subject: 'A quick update on your website', created_at: new Date(Date.now() - 1000 * 60 * 48).toISOString(), last_event: 'delivered' },
  { id: 'demo_3', to: ['olivia@sample.com'], from: 'Website Thanks <hello@websitethanks.com>', subject: 'Confirm your email address', created_at: new Date(Date.now() - 1000 * 60 * 93).toISOString(), last_event: 'delivery_delayed' },
  { id: 'demo_4', to: ['noah@sample.com'], from: 'Website Thanks <hello@websitethanks.com>', subject: 'Your monthly website report', created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), last_event: 'sent' },
  { id: 'demo_5', to: ['amelia@sample.com'], from: 'Website Thanks <hello@websitethanks.com>', subject: 'A note from the Website Thanks team', created_at: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(), last_event: 'opened' },
];

const labels: Record<string, string> = { delivered: 'Delivered', sent: 'Sent', bounced: 'Bounced', delivery_delayed: 'Delayed', opened: 'Opened', clicked: 'Clicked', complained: 'Complaint', failed: 'Failed' };
const tone: Record<string, string> = { delivered: 'good', opened: 'good', clicked: 'good', sent: 'neutral', bounced: 'bad', failed: 'bad', complained: 'bad', delivery_delayed: 'wait' };
function date(value: string) { return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

export default function Home() {
  const [emails, setEmails] = useState<Email[]>(demo);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All mail');
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/emails').then(async (res) => {
      const data = await res.json();
      if (data.configured) { setConfigured(true); setEmails(data.data ?? []); }
    }).catch(() => setNotice('Could not reach the email service. Showing sample activity.')).finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => emails.filter((email) => {
    const q = query.toLowerCase();
    const matchesQuery = !q || [email.subject, email.from, ...email.to].join(' ').toLowerCase().includes(q);
    const status = email.last_event.toLowerCase();
    const matchesFilter = filter === 'All mail' || (filter === 'Needs attention' ? ['bounced', 'failed', 'delivery_delayed', 'complained'].includes(status) : filter === 'Delivered' ? ['delivered', 'opened', 'clicked'].includes(status) : true);
    return matchesQuery && matchesFilter;
  }), [emails, query, filter]);
  const attention = emails.filter((email) => ['bounced', 'failed', 'delivery_delayed', 'complained'].includes(email.last_event.toLowerCase())).length;

  async function resend(email: Email) {
    if (!configured || email.id.startsWith('demo_')) { setNotice('Connect Resend to resend real messages.'); return; }
    if (!window.confirm(`Send “${email.subject}” again to ${email.to.join(', ')}?`)) return;
    setSending(email.id); setNotice('');
    try {
      const response = await fetch(`/api/emails/${encodeURIComponent(email.id)}/resend`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Resend failed.');
      setNotice(`Sent “${email.subject}” again.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Resend failed.'); }
    finally { setSending(null); }
  }

  return <main className="shell">
    <aside className="rail"><a className="brand" href="#top" aria-label="Website Thanks Mailroom home"><span className="brandMark">w</span><span>website thanks<small>MAILROOM</small></span></a><div className="railLabel">WORKSPACE</div><button className="navItem active"><span className="navIcon">▤</span> Email activity <span className="navCount">{emails.length}</span></button><button className="navItem" onClick={() => { setFilter('Needs attention'); document.getElementById('activity')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="navIcon">⌁</span> Needs attention {attention > 0 && <span className="navCount alertCount">{attention}</span>}</button><div className="railBottom"><div className="avatar">WT</div><span>Website Thanks<small>Operations</small></span><button className="more" aria-label="Workspace options">···</button></div></aside>
    <section className="content" id="top"><header className="topbar"><div className="breadcrumb">Mailroom <span>/</span> <strong>Email activity</strong></div><div className="topActions"><span className={`connection ${configured ? 'connected' : ''}`}><i />{configured ? 'Resend connected' : 'Demo mode'}</span><button className="help">?</button></div></header>
      <div className="page"><div className="intro"><div><div className="eyebrow">MESSAGING OPERATIONS</div><h1>Email activity</h1><p>See what landed, what needs a nudge, and send it again when it matters.</p></div><button className="button buttonDark" onClick={() => { setLoading(true); fetch('/api/emails').then(r => r.json()).then(d => { if (d.configured) { setConfigured(true); setEmails(d.data ?? []); } }).catch(() => setNotice('Refresh failed.')).finally(() => setLoading(false)); }}>↻ &nbsp; Refresh activity</button></div>
        <div className="metrics"><article className="metric"><span>Messages in view</span><strong>{emails.length.toLocaleString('en-AU')}</strong><small>Recent activity from Resend</small><div className="metricGlyph">✉</div></article><article className="metric"><span>Needs attention</span><strong>{attention.toLocaleString('en-AU')}</strong><small>{attention ? 'Review delivery issues below' : 'Nothing waiting on you'}</small><div className="metricGlyph">⌁</div></article><article className="metric"><span>Connection</span><strong className="metricStatus">{configured ? 'Connected' : 'Not connected'}</strong><small>{configured ? 'Ready to send and review' : 'Add your Resend details to begin'}</small><div className="metricGlyph">↗</div></article></div>
        <section className="activity" id="activity"><div className="activityHeader"><div><h2>Recent messages</h2><p>A live record of messages sent through Website Thanks.</p></div><button className="button buttonLight" onClick={() => { setFilter(filter === 'All mail' ? 'Needs attention' : 'All mail'); }}>☷ &nbsp; {filter === 'All mail' ? 'Filter' : 'Show all'}</button></div>
          <div className="tableTools"><label className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by recipient or subject" /></label><div className="tabs">{['All mail', 'Needs attention', 'Delivered'].map(tab => <button key={tab} className={filter === tab ? 'tab selected' : 'tab'} onClick={() => setFilter(tab)}>{tab}{tab === 'Needs attention' && attention > 0 && <b>{attention}</b>}</button>)}</div></div>
          <div className="tableWrap"><table><thead><tr><th>RECIPIENT</th><th>SUBJECT</th><th>STATUS</th><th>SENT</th><th><span className="srOnly">Actions</span></th></tr></thead><tbody>{shown.map(email => <tr key={email.id}><td><div className="recipient"><div className="person">{(email.to[0] ?? '?').slice(0,1).toUpperCase()}</div><span>{email.to.join(', ')}</span></div></td><td className="subject">{email.subject}</td><td><span className={`status ${tone[email.last_event] ?? 'neutral'}`}><i />{labels[email.last_event] ?? email.last_event}</span></td><td className="dateCell">{date(email.created_at)}</td><td className="actions"><button className="resend" onClick={() => resend(email)} disabled={sending === email.id}>{sending === email.id ? 'Sending…' : 'Resend'}</button></td></tr>)}{!shown.length && <tr><td colSpan={5} className="empty">{loading ? 'Loading your messages…' : 'No messages match this view.'}</td></tr>}</tbody></table></div>
          <div className="tableFoot"><span>Showing {shown.length} of {emails.length} messages</span><span>Activity refreshes when you visit</span></div>
        </section><footer>Website Thanks Mailroom <span>·</span> Email operations, made a little simpler.</footer>
      </div>{notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    </section>
  </main>;
}
