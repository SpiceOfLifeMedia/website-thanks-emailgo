const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export type BroadcastMetadata = { replyTo: string | null; previewText: string | null };

export function parseBroadcastMetadata(replyToValue: unknown, previewTextValue: unknown):
  | { ok: true; value: BroadcastMetadata }
  | { ok: false; error: string } {
  const replyTo = replyToValue === undefined || replyToValue === null
    ? null
    : typeof replyToValue === 'string' ? replyToValue.trim() || null : undefined;
  if (replyTo === undefined || (replyTo !== null && (replyTo.length > 320 || /[\r\n]/.test(replyTo)
    || !emailPattern.test((/<([^<>]+)>$/.exec(replyTo)?.[1] ?? replyTo).trim())))) {
    return { ok: false, error: 'reply_to must be a valid email address.' };
  }

  const previewText = previewTextValue === undefined || previewTextValue === null
    ? null
    : typeof previewTextValue === 'string' ? previewTextValue.trim() || null : undefined;
  if (previewText === undefined || (previewText !== null && (previewText.length > 500 || /[\r\n]/.test(previewText)))) {
    return { ok: false, error: 'preview_text must be a single line of up to 500 characters.' };
  }

  return { ok: true, value: { replyTo, previewText } };
}
