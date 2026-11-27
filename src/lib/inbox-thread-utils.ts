import { createHash } from 'node:crypto';

export const inboxFolders = ['inbox', 'sent', 'archive', 'spam', 'trash'] as const;
export type InboxFolder = (typeof inboxFolders)[number];

/** Extract RFC-style message IDs without accepting header line breaks or oversized values. */
export function parseMessageIds(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 5000 || /[\r\n]/.test(value)) return [];
  const bracketed = value.match(/<[^<>\s]{1,998}>/g) ?? [];
  const values = bracketed.length ? bracketed : value.trim().split(/\s+/).filter((item) => item.length > 0 && item.length <= 998);
  return [...new Set(values.map((item) => item.startsWith('<') && item.endsWith('>') ? item : `<${item}>`))];
}

export function replyReferences(headers: Record<string, string> | null | undefined): string[] {
  if (!headers) return [];
  const values = Object.entries(headers).reduce<Record<string, string>>((result, [name, value]) => {
    result[name.toLowerCase()] = value;
    return result;
  }, {});
  const inReplyTo = parseMessageIds(values['in-reply-to']);
  const references = parseMessageIds(values.references);
  return [...new Set([...inReplyTo, ...references])];
}

/** Keep complete Message-ID tokens while bounding the outgoing References header. */
export function boundedMessageReferences(values: string[], maxLength = 998): string {
  const ids = [...new Set(values)];
  while (ids.length && ids.join(' ').length > maxLength) ids.shift();
  return ids.join(' ');
}

/** Stable across retries even when the conversation gains another message. */
export function replyRequestHash(threadId: string, text: string): string {
  return createHash('sha256').update(JSON.stringify({ threadId, text })).digest('hex');
}

const inboxEmailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export type InboxComposeMode = 'reply' | 'reply_all' | 'forward';

/** Pulls one address from a stored mailbox value and rejects header injection. */
export function extractMailboxAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500 || /[\r\n\u0000-\u001f\u007f]/.test(value)) return null;
  const candidate = (/<([^<>]+)>$/.exec(value.trim())?.[1] ?? value).trim();
  return candidate.length <= 320 && inboxEmailPattern.test(candidate) ? candidate : null;
}

/** Validates a bounded recipient array while preserving the user's casing and order. */
export function normalizeInboxRecipients(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const address = item.trim();
    if (!address) continue;
    const normalized = extractMailboxAddress(address);
    if (!normalized) return null;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      recipients.push(normalized);
      seen.add(key);
    }
  }
  return recipients;
}

/** Parses the comma-separated recipient fields used by the inbox composer. */
export function parseInboxRecipientText(value: unknown): string[] | null {
  if (Array.isArray(value)) return normalizeInboxRecipients(value);
  if (typeof value !== 'string' || value.length > 10_000 || /[\r\n\u0000-\u001f\u007f]/.test(value)) return null;
  const entries: string[] = [];
  let entry = '';
  let inQuotes = false;
  let angleDepth = 0;
  for (const character of value) {
    if (character === '"') inQuotes = !inQuotes;
    if (!inQuotes && character === '<') angleDepth += 1;
    if (!inQuotes && character === '>' && angleDepth > 0) angleDepth -= 1;
    if (!inQuotes && angleDepth === 0 && (character === ',' || character === ';')) {
      entries.push(entry);
      entry = '';
    } else {
      entry += character;
    }
  }
  entries.push(entry);
  return normalizeInboxRecipients(entries);
}

/** Uses the latest received message's reply address and preserves the visible To and Cc groups. */
export function replyAllRecipients(input: {
  from: unknown;
  replyTo?: unknown;
  to: unknown;
  cc?: unknown;
  inboxAddress: unknown;
}): { to: string[]; cc: string[] } | null {
  const originalSender = extractMailboxAddress(input.from);
  const primary = extractMailboxAddress(input.replyTo) ?? originalSender;
  const inbox = extractMailboxAddress(input.inboxAddress);
  const originalTo = normalizeInboxRecipients(input.to);
  const originalCc = normalizeInboxRecipients(input.cc ?? []);
  if (!originalSender || !primary || !inbox || !originalTo || !originalCc) return null;
  const seen = new Set([inbox.toLowerCase()]);
  const to = [primary, ...originalTo].filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  seen.add(originalSender.toLowerCase());
  const cc = originalCc.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { to, cc };
}

export function composeSubject(mode: InboxComposeMode, subject: string): string {
  const base = subject.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 900) || '(no subject)';
  const prefix = mode === 'forward' ? 'Fwd:' : 'Re:';
  return new RegExp(`^${mode === 'forward' ? 'fwd' : 're'}\\s*:`, 'i').test(base) ? base : `${prefix} ${base}`;
}

/** Stable for retries of one composed message, regardless of later thread activity. */
export function composeRequestHash(threadId: string, message: {
  mode: InboxComposeMode; from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string;
}): string {
  return createHash('sha256').update(JSON.stringify({ threadId, ...message })).digest('hex');
}

export function normalizeFolder(value: unknown): InboxFolder | null {
  return typeof value === 'string' && inboxFolders.includes(value as InboxFolder) ? value as InboxFolder : null;
}

export function makeMessagePreview(text: string | null, html: string | null) {
  const source = text?.trim() || html?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'") || '';
  return source.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function safeLabels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item)) return null;
    const label = item.trim().replace(/\s+/g, ' ');
    if (!label || label.length > 40 || /[\r\n\u0000-\u001f]/.test(label)) return null;
    if (!normalized.some((existing) => existing.toLocaleLowerCase() === label.toLocaleLowerCase())) normalized.push(label);
  }
  return normalized;
}

export function searchClause(search: string) {
  const clean = search.trim().slice(0, 200).toLowerCase();
  const escaped = clean.replace(/[!%_]/g, '!$&');
  const term = `%${escaped}%`;
  return {
    sql: `(${[
      'LOWER(COALESCE(sender,\'\')) LIKE ? ESCAPE \'!\'',
      'LOWER(COALESCE(recipients_json,\'\')) LIKE ? ESCAPE \'!\'',
      'LOWER(COALESCE(subject,\'\')) LIKE ? ESCAPE \'!\'',
      'LOWER(COALESCE(preview,\'\')) LIKE ? ESCAPE \'!\'',
    ].join(' OR ')})`,
    params: [term, term, term, term],
  };
}
