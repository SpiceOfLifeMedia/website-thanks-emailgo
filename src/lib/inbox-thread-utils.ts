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
  const parsed = parseInboxSearch(search);
  if (parsed.error) return { sql: '', params: [] as string[], error: parsed.error };

  const clauses: string[] = [];
  const messageFilters: string[] = [];
  const params: string[] = [];
  const searchableFields = [
    'sender', 'recipients_json', 'subject', 'preview',
  ].map((field) => `LOWER(COALESCE(message_match.${field},'')) LIKE ? ESCAPE '!'`);

  for (const term of parsed.terms) {
    messageFilters.push(`(${searchableFields.join(' OR ')})`);
    params.push(...searchableFields.map(() => likeTerm(term)));
  }
  for (const value of parsed.from) {
    messageFilters.push("LOWER(COALESCE(message_match.sender,'')) LIKE ? ESCAPE '!'");
    params.push(likeTerm(value));
  }
  for (const value of parsed.to) {
    messageFilters.push("LOWER(COALESCE(message_match.recipients_json,'')) LIKE ? ESCAPE '!'");
    params.push(likeTerm(value));
  }
  for (const value of parsed.subject) {
    messageFilters.push("LOWER(COALESCE(message_match.subject,'')) LIKE ? ESCAPE '!'");
    params.push(likeTerm(value));
  }
  if (messageFilters.length) {
    clauses.push(`EXISTS (SELECT 1 FROM messages message_match WHERE message_match.thread_id=ranked.thread_id
      AND ${messageFilters.join(' AND ')})`);
  }
  for (const value of parsed.before) {
    clauses.push('ranked.updated_at<?');
    params.push(`${value}T00:00:00.000Z`);
  }
  for (const value of parsed.after) {
    clauses.push('ranked.updated_at>=?');
    params.push(`${value}T00:00:00.000Z`);
  }
  if (parsed.readState === 'unread') clauses.push('COALESCE(threads.is_read,0)=0');
  if (parsed.readState === 'read') clauses.push('COALESCE(threads.is_read,0)=1');

  return { sql: clauses.length ? `(${clauses.join(' AND ')})` : '1=1', params, error: null };
}

type ParsedInboxSearch = {
  terms: string[];
  from: string[];
  to: string[];
  subject: string[];
  before: string[];
  after: string[];
  readState: 'read' | 'unread' | null;
  error: string | null;
};

function tokenizeInboxSearch(search: string): { tokens: string[]; error: string | null } {
  const tokens: string[] = [];
  let token = '';
  let quoted = false;
  let escaped = false;

  for (const character of search.trim().slice(0, 200)) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = '';
      continue;
    }
    token += character;
  }

  if (quoted) return { tokens: [], error: 'Add a closing quote to finish this search.' };
  if (escaped) token += '\\';
  if (token) tokens.push(token);
  return { tokens, error: null };
}

function validSearchDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseInboxSearch(search: string): ParsedInboxSearch {
  const tokenized = tokenizeInboxSearch(search);
  const parsed: ParsedInboxSearch = {
    terms: [], from: [], to: [], subject: [], before: [], after: [], readState: null, error: tokenized.error,
  };
  if (parsed.error) return parsed;

  for (const token of tokenized.tokens) {
    const operator = /^(from|to|subject|before|after|is):(.*)$/i.exec(token);
    if (!operator) {
      parsed.terms.push(token);
      continue;
    }
    const [, name, rawValue] = operator;
    const rawValueTrimmed = rawValue.trim();
    const key = name.toLowerCase();
    if (key === 'is') {
      const value = rawValueTrimmed.toLowerCase();
      if (value !== 'read' && value !== 'unread') {
        parsed.error = 'Use is:read or is:unread to filter read state.';
        return parsed;
      }
      if (parsed.readState && parsed.readState !== value) {
        parsed.error = 'Choose either is:read or is:unread for this search.';
        return parsed;
      }
      parsed.readState = value;
      continue;
    }
    if (!rawValueTrimmed) {
      parsed.error = `Add a value after ${key}: to finish this search.`;
      return parsed;
    }
    if (key === 'before' || key === 'after') {
      if (!validSearchDate(rawValueTrimmed)) {
        parsed.error = `${key}: needs a valid date in YYYY-MM-DD format.`;
        return parsed;
      }
      if (key === 'before') parsed.before.push(rawValueTrimmed);
      else parsed.after.push(rawValueTrimmed);
      continue;
    }
    if (key === 'from') parsed.from.push(rawValueTrimmed);
    else if (key === 'to') parsed.to.push(rawValueTrimmed);
    else parsed.subject.push(rawValueTrimmed);
  }
  if (!parsed.terms.length && !parsed.from.length && !parsed.to.length && !parsed.subject.length
    && !parsed.before.length && !parsed.after.length && !parsed.readState) {
    parsed.error = 'Add a word or filter to search conversations.';
  }
  return parsed;
}

function likeTerm(value: string) {
  return `%${value.toLowerCase().replace(/[!%_]/g, '!$&')}%`;
}
