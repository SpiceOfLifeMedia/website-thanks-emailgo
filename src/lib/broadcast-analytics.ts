export const MAX_BROADCAST_ANALYTICS_EVENTS = 5_000;

export function broadcastAnalyticsPage<T>(rows: T[], limit: number, after: string | null, before: string | null, getKey: (row: T) => string) {
  if (after && before) return { ok: false as const, error: 'Use either after or before, not both.' };
  const decode = (value: string | null) => {
    if (value === null) return undefined;
    try {
      const cursor = Buffer.from(value, 'base64url').toString('utf8');
      if (!cursor.startsWith('key:')) return null;
      return cursor.slice('key:'.length);
    } catch { return null; }
  };
  const afterKey = decode(after);
  const beforeKey = decode(before);
  if (afterKey === null || beforeKey === null) return { ok: false as const, error: 'The pagination cursor is invalid.' };
  const firstIndex = (matches: (key: string) => boolean) => rows.findIndex((row) => matches(getKey(row)));
  let start = 0;
  if (afterKey !== undefined) {
    const nextIndex = firstIndex((key) => key > afterKey);
    start = nextIndex < 0 ? rows.length : nextIndex;
  } else if (beforeKey !== undefined) {
    const endIndex = firstIndex((key) => key >= beforeKey);
    start = Math.max(0, (endIndex < 0 ? rows.length : endIndex) - limit);
  }
  const data = rows.slice(start, start + limit);
  const hasMore = start + data.length < rows.length;
  const hasPrevious = start > 0;
  const encode = (key: string) => Buffer.from(`key:${key}`).toString('base64url');
  return {
    ok: true as const,
    data,
    hasMore,
    ...(hasMore && data.length ? { next_after: encode(getKey(data[data.length - 1])) } : {}),
    ...(hasPrevious && data.length ? { next_before: encode(getKey(data[0])) } : {}),
  };
}

export function broadcastRecipientEmail(address: string) {
  const angleAddress = /<([^<>]+)>$/.exec(address.trim())?.[1];
  return (angleAddress ?? address).trim().toLowerCase();
}
