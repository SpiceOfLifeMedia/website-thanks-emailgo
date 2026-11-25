export type EmailRecord = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string;
};

const API = 'https://api.resend.com';

export function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function listEmails(): Promise<EmailRecord[]> {
  const response = await fetch(`${API}/emails`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.data) ? data.data : [];
}

export async function resendEmail(id: string) {
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };
  const originalResponse = await fetch(`${API}/emails/${encodeURIComponent(id)}`, { headers, cache: 'no-store' });
  const original = await originalResponse.json().catch(() => ({}));
  if (!originalResponse.ok) throw new Error(typeof original.message === 'string' ? original.message : `Resend returned ${originalResponse.status}`);
  if (typeof original.html !== 'string' && typeof original.text !== 'string') throw new Error('This email has no stored body to resend.');
  const body: Record<string, unknown> = {
    from: process.env.RESEND_FROM,
    to: original.to,
    subject: original.subject,
    ...(typeof original.html === 'string' ? { html: original.html } : {}),
    ...(typeof original.text === 'string' ? { text: original.text } : {}),
    ...(Array.isArray(original.reply_to) && original.reply_to.length ? { reply_to: original.reply_to } : {}),
    ...(Array.isArray(original.cc) && original.cc.length ? { cc: original.cc } : {}),
    ...(Array.isArray(original.bcc) && original.bcc.length ? { bcc: original.bcc } : {}),
    ...(Array.isArray(original.tags) && original.tags.length ? { tags: original.tags } : {}),
  };
  const response = await fetch(`${API}/emails`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : `Resend returned ${response.status}`);
  return payload;
}
