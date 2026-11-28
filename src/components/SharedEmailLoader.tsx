'use client';

import { useEffect, useState } from 'react';
import SharedEmailPage, { type SharedEmailData } from './SharedEmailPage';

type PublicShareResponse = {
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  sent_at: string;
  expires_at: string;
  has_attachments: boolean;
};

function emailData(value: PublicShareResponse): SharedEmailData {
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.from);
  return {
    subject: value.subject,
    from: match?.[2] ?? value.from,
    fromName: match?.[1].replace(/^['"]|['"]$/g, '').trim() || undefined,
    to: value.to.join(', '),
    sentAt: value.sent_at,
    text: value.text,
    expiresAt: value.expires_at,
    hasAttachments: value.has_attachments,
  };
}

export default function SharedEmailLoader() {
  const [email, setEmail] = useState<SharedEmailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!/^shr_live_[A-Za-z0-9_-]{43}$/.test(token)) { setLoading(false); return; }

    let active = true;
    void fetch('/api/share/view', {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
    }).then(async response => {
      if (!response.ok) return null;
      return await response.json() as PublicShareResponse;
    }).then(value => {
      if (active && value) setEmail(emailData(value));
    }).catch(() => {
      // Unknown, expired, and revoked links all share the same unavailable page.
    }).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, []);

  return <SharedEmailPage email={email} loading={loading} />;
}
