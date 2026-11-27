export type BroadcastTemplateValues = Readonly<Record<string, unknown>>;

const variablePattern = /\{\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*(?:\|\s*([^{}]{0,2000}?))?\s*\}\}\}|\{\{\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*(?:\|\s*([^{}]{0,2000}?))?\s*\}\}/g;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

/**
 * Render broadcast merge tags. Double braces escape HTML. Triple braces are an
 * explicit opt-in to raw HTML for trusted template values. A pipe introduces a
 * literal fallback used only when the value is absent or null.
 */
export function renderBroadcastContent(source: string | null, values: BroadcastTemplateValues, html: boolean): string | null {
  if (source === null) return null;
  return source.replace(variablePattern, (_match, tripleName: string | undefined, tripleFallback: string | undefined, doubleName: string | undefined, doubleFallback: string | undefined) => {
    const name = tripleName ?? doubleName;
    if (!name) return '';
    const triple = tripleName !== undefined;
    const value = values[name];
    const resolved = value === undefined || value === null
      ? (triple ? tripleFallback : doubleFallback) ?? ''
      : String(value);
    return html && !triple ? escapeHtml(resolved) : resolved;
  });
}

export function broadcastContactVariables(input: {
  properties: Record<string, unknown>;
  email: string;
  name: string | null;
  preferencesUrl: string;
  unsubscribeUrl: string;
}): Record<string, unknown> {
  const nameParts = (input.name ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.shift() ?? '';
  const lastName = nameParts.join(' ');
  return {
    ...input.properties,
    email: input.email,
    name: input.name ?? '',
    first_name: firstName,
    last_name: lastName,
    preferences_url: input.preferencesUrl,
    unsubscribe_url: input.unsubscribeUrl,
    EMAIL: input.email,
    FIRST_NAME: firstName,
    LAST_NAME: lastName,
    PREFERENCES_URL: input.preferencesUrl,
    UNSUBSCRIBE_URL: input.unsubscribeUrl,
  };
}
