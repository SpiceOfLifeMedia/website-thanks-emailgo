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
