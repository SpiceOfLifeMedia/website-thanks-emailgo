import { query, queryOne } from '@/lib/database';
import { authorizeApiKey, hasFullApiAccess, hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { parseSegmentFilters, segmentWhere } from '@/lib/segments';

export type BroadcastInput = {
  name: string;
  apiKeyId: string;
  from: string;
  subject: string;
  text: string | null;
  html: string | null;
  audienceType: 'segment' | 'topic';
  audienceId: string;
};

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export async function authorizeBroadcastRequest(request: Request): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const origin = request.headers.get('origin');
  if (origin && !hasTrustedBrowserOrigin(request)) return { ok: false, status: 403, error: 'Request origin is not allowed.' };
  if (await isAdminSession()) return hasTrustedBrowserOrigin(request) ? { ok: true } : { ok: false, status: 403, error: 'Request origin is not allowed.' };
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return { ok: false, status: 401, error: 'Sign in or provide a full-access API key.' };
  if (!hasFullApiAccess(apiKey)) return { ok: false, status: 403, error: 'This API key has sending-only access.' };
  return { ok: true };
}

export function parseBroadcastInput(value: unknown): { ok: true; value: BroadcastInput } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Request body must be a JSON object.' };
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const apiKeyId = typeof body.api_key_id === 'string' ? body.api_key_id : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = body.text === undefined || body.text === null ? null : typeof body.text === 'string' ? body.text : undefined;
  const html = body.html === undefined || body.html === null ? null : typeof body.html === 'string' ? body.html : undefined;
  const audienceType = body.audience_type;
  const audienceId = typeof body.audience_id === 'string' ? body.audience_id : '';
  const sender = /<([^<>]+)>$/.exec(from)?.[1] ?? from;
  if (!name || name.length > 120 || /[\r\n]/.test(name)) return { ok: false, error: 'name must be 1 to 120 single-line characters.' };
  if (!apiKeyId || apiKeyId.length > 100) return { ok: false, error: 'Choose an active API key.' };
  if (!from || from.length > 254 || /[\r\n]/.test(from) || !emailPattern.test(sender)) return { ok: false, error: 'from must be a valid sender email address.' };
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) return { ok: false, error: 'subject must be 1 to 998 characters and cannot contain line breaks.' };
  if (text === undefined || html === undefined) return { ok: false, error: 'text and html must be strings when supplied.' };
  if (text === null && html === null) return { ok: false, error: 'Provide text, html or both.' };
  if ((text?.length ?? 0) > 500_000 || (html?.length ?? 0) > 500_000) return { ok: false, error: 'Email content exceeds the 500 KB limit.' };
  if (audienceType !== 'segment' && audienceType !== 'topic') return { ok: false, error: 'audience_type must be segment or topic.' };
  if (!audienceId || audienceId.length > 100) return { ok: false, error: 'Choose a saved segment or topic.' };
  return { ok: true, value: { name, apiKeyId, from, subject, text, html, audienceType, audienceId } };
}

export async function validateBroadcastInput(input: BroadcastInput) {
  const key = await queryOne<{ id: string; permission: string; domain_id: string | null }>('SELECT id,permission,domain_id FROM api_keys WHERE id=? AND revoked_at IS NULL', [input.apiKeyId]);
  if (!key) return { error: 'The selected API key is not active.', status: 400 } as const;
  const sender = /<([^<>]+)>$/.exec(input.from)?.[1] ?? input.from;
  const senderDomain = sender.slice(sender.lastIndexOf('@') + 1).toLowerCase();
  const domains = await query<{ id: string; domain: string }>('SELECT id,domain FROM domains WHERE verified_at IS NOT NULL');
  const domain = domains.rows.filter((entry) => senderDomain === entry.domain.toLowerCase() || senderDomain.endsWith(`.${entry.domain.toLowerCase()}`)).sort((a, b) => b.domain.length - a.domain.length)[0];
  if (!domain) return { error: 'The sender domain must be verified in Emailgo.', status: 403 } as const;
  if (key.permission === 'sending_access' && key.domain_id !== domain.id) return { error: 'The selected sending-only key is restricted to a different sender domain.', status: 403 } as const;
  if (input.audienceType === 'segment') {
    const segment = await queryOne<{ id: string }>('SELECT id FROM segments WHERE id=?', [input.audienceId]);
    if (!segment) return { error: 'The selected segment does not exist.', status: 404 } as const;
  } else {
    const topic = await queryOne<{ id: string }>('SELECT id FROM topics WHERE id=? AND disabled_at IS NULL', [input.audienceId]);
    if (!topic) return { error: 'The selected topic does not exist or is archived.', status: 404 } as const;
  }
  return { key, domain } as const;
}

export async function eligibleBroadcastContacts(input: Pick<BroadcastInput, 'audienceType' | 'audienceId'>, max = 1001) {
  if (input.audienceType === 'topic') {
    const result = await query<{ id: string; email: string; name: string | null; properties_json: string }>(`SELECT c.id,c.email,c.name,c.properties_json FROM contacts c
      JOIN contact_topics ct ON ct.contact_id=c.id JOIN topics t ON t.id=ct.topic_id AND t.disabled_at IS NULL
      WHERE ct.topic_id=? AND ct.subscribed_at IS NOT NULL AND ct.unsubscribed_at IS NULL
        AND c.consent_status='opted_in' AND c.unsubscribed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.normalized_email=lower(c.email))
      ORDER BY c.id ASC LIMIT ?`, [input.audienceId, max]);
    return result.rows;
  }
  const segment = await queryOne<{ filters_json: string }>('SELECT filters_json FROM segments WHERE id=?', [input.audienceId]);
  if (!segment) return [];
  let filters: unknown;
  try { filters = JSON.parse(segment.filters_json); } catch { return []; }
  const parsedFilters = parseSegmentFilters(filters);
  if (!parsedFilters.ok) return [];
  const filter = segmentWhere(parsedFilters.filters, input.audienceId);
  const where = filter.where ? ` AND ${filter.where}` : '';
  const result = await query<{ id: string; email: string; name: string | null; properties_json: string }>(`SELECT c.id,c.email,c.name,c.properties_json FROM contacts c
    WHERE c.consent_status='opted_in' AND c.unsubscribed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.normalized_email=lower(c.email)) ${where}
    ORDER BY c.id ASC LIMIT ?`, [...filter.params, max]);
  return result.rows;
}
