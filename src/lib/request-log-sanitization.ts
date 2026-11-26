const shareToken = /(?<![A-Za-z0-9_-])shr_live_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

export function redactShareTokens(value: string) {
  return value.replace(shareToken, '[REDACTED]');
}
