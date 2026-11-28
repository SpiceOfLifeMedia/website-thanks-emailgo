const MAX_SHARE_AGE_MS = 48 * 60 * 60 * 1000;

export function shareExpirationMs(value: unknown): number | null {
  if (value === undefined) return MAX_SHARE_AGE_MS;
  if (typeof value !== 'string') return null;
  const match = /^([1-9]\d*)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount)) return null;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 60 * 60_000 : 24 * 60 * 60_000;
  const result = amount * multiplier;
  return result > 0 && result <= MAX_SHARE_AGE_MS ? result : null;
}

export function sharePublicOrigin(configured: string | undefined, production: boolean) {
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    if (production && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function decodeEmailEntities(value: string) {
  const named: Record<string, string> = { amp: '&', apos: "'", copy: '©', gt: '>', hellip: '…', ldquo: '“', lsquo: '‘', lt: '<', mdash: '—', nbsp: ' ', ndash: '–', quot: '"', rdquo: '”', reg: '®', rsquo: '’' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
    if (value[0] === '#') {
      const number = value[1]?.toLowerCase() === 'x' ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
    }
    return named[value.toLowerCase()] ?? entity;
  });
}

export function emailHtmlToPlainText(html: string) {
  return decodeEmailEntities(html
    .replace(/<(head|style|script|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, _quote: string, href: string, label: string) => `${label.replace(/<[^>]*>/g, '')} (${href})`)
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<(?:p|div|tr|blockquote|section|article|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|article)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<img\b[^>]*alt\s*=\s*(["'])(.*?)\1[^>]*>/gi, ' $2 ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\t\u00a0 ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
