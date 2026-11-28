const shareToken = /(?<![A-Za-z0-9_-])shr_live_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const sensitiveField = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential|idempotency|email|recipient|\bto\b|\bcc\b|\bbcc\b|reply[_-]?to|subject|text|html|content|attachment|header|propert|tag|name$|phone|address|design)/i;
const secretValue = /\b(?:(?:eg|st)_live_|whsec_)[A-Za-z0-9_-]{16,}\b/g;
const emailValue = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactShareTokens(value: string) {
  return value.replace(shareToken, '[REDACTED]');
}

export function sanitizeApiLogText(value: string) {
  return redactShareTokens(value.replace(secretValue, '[REDACTED]').replace(emailValue, '[REDACTED_EMAIL]'));
}

function senderDomain(value: unknown) {
  if (typeof value !== 'string') return '[REDACTED]';
  const address = value.match(emailValue)?.[0];
  const at = address?.lastIndexOf('@') ?? -1;
  return at > 0 ? `[REDACTED]@${address!.slice(at + 1).toLowerCase()}` : '[REDACTED]';
}

export function sanitizeApiLogValue(value: unknown, parentKey = ''): unknown {
  if (parentKey.toLowerCase() === 'from') return senderDomain(value);
  if (sensitiveField.test(parentKey)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeApiLogText(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeApiLogValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeApiLogValue(entry, key)]));
  }
  return value;
}
