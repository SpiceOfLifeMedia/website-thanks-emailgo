import { getAuthorizedRequestKey } from '@/lib/auth';
import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';

const BODY_LIMIT = 64 * 1024;
const sensitiveField = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential|idempotency|email|recipient|\bto\b|\bcc\b|\bbcc\b|reply[_-]?to|subject|text|html|content|attachment|header|propert|tag|name$|phone|address)/i;
const secretValue = /\b(?:(?:eg|st)_live_|whsec_)[A-Za-z0-9_-]{16,}\b/g;
const emailValue = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type CapturedBody = { json: string | null; bytes: number | null };
type ApiLogRow = {
  id: string;
  api_key_name: string | null;
  api_key_prefix: string | null;
  endpoint: string;
  method: string;
  response_status: number;
  user_agent: string | null;
  request_bytes: number | null;
  response_bytes: number | null;
  request_body_json: string | null;
  response_body_json: string | null;
  created_at: string;
};

function senderDomain(value: unknown) {
  if (typeof value !== 'string') return '[REDACTED]';
  const address = value.match(emailValue)?.[0];
  const at = address?.lastIndexOf('@') ?? -1;
  return at > 0 ? `[REDACTED]@${address!.slice(at + 1).toLowerCase()}` : '[REDACTED]';
}

function redact(value: unknown, parentKey = ''): unknown {
  if (parentKey.toLowerCase() === 'from') return senderDomain(value);
  if (sensitiveField.test(parentKey)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(secretValue, '[REDACTED]').replace(emailValue, '[REDACTED_EMAIL]');
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry, key)]));
  }
  return value;
}

function contentLength(message: Request | Response) {
  const headerValue = message.headers.get('content-length');
  if (!headerValue || !/^\d+$/.test(headerValue)) return null;
  const bytes = Number(headerValue);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

async function captureJsonBody(message: Request | Response): Promise<CapturedBody> {
  const declaredBytes = contentLength(message);
  if (!message.headers.get('content-type')?.toLowerCase().includes('application/json')) return { json: null, bytes: declaredBytes };
  if (declaredBytes !== null && declaredBytes > BODY_LIMIT) return { json: JSON.stringify({ _truncated: true }), bytes: declaredBytes };
  const body = message.clone().body;
  if (!body) return { json: null, bytes: declaredBytes ?? 0 };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) {
        await reader.cancel().catch(() => undefined);
        return { json: JSON.stringify({ _truncated: true }), bytes: declaredBytes };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object') return { json: null, bytes: declaredBytes ?? length };
    return { json: JSON.stringify(redact(parsed)), bytes: declaredBytes ?? length };
  } catch {
    return { json: null, bytes: declaredBytes ?? length };
  } finally {
    reader.releaseLock();
  }
}

function safeKeyName(name: string) {
  return name.slice(0, 120).replace(secretValue, '[REDACTED]').replace(emailValue, '[REDACTED_EMAIL]');
}

async function recordLog(
  request: Request,
  id: string,
  responseStatus: number,
  requestBody: CapturedBody,
  responseBody: CapturedBody,
) {
  const apiKey = getAuthorizedRequestKey(request);
  if (!apiKey) return;
  const endpoint = new URL(request.url).pathname.slice(0, 300).replace(emailValue, '[REDACTED_EMAIL]');
  const method = request.method.toUpperCase().slice(0, 12);
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null;
  await execute(`INSERT INTO api_request_logs(
    id,api_key_id,api_key_name,api_key_prefix,endpoint,method,response_status,user_agent,
    request_bytes,response_bytes,request_body_json,response_body_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    id, apiKey.id, safeKeyName(apiKey.name), apiKey.prefix, endpoint, method, responseStatus, userAgent,
    requestBody.bytes, responseBody.bytes, requestBody.json, responseBody.json, nowIso(),
  ]);
}

function responseWithRequestId(response: Response, id: string) {
  const headers = new Headers(response.headers);
  headers.set('x-request-id', id);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function withApiRequestLog<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response> | Response) {
  return async function loggedApiRequest(request: Request, ...args: Args): Promise<Response> {
    const id = randomId('log');
    const requestBody = await captureJsonBody(request);
    try {
      const response = await handler(request, ...args);
      const responseBody = await captureJsonBody(response);
      const authorized = getAuthorizedRequestKey(request);
      try { await recordLog(request, id, response.status, requestBody, responseBody); } catch { /* Logging must not change the API response. */ }
      return authorized ? responseWithRequestId(response, id) : response;
    } catch (error) {
      try { await recordLog(request, id, 500, requestBody, { json: null, bytes: null }); } catch { /* Logging must not change the API response. */ }
      throw error;
    }
  };
}

function toLog(row: ApiLogRow, includeBodies = false) {
  return {
    id: row.id,
    object: 'log',
    created_at: row.created_at,
    endpoint: row.endpoint,
    method: row.method,
    response_status: row.response_status,
    user_agent: row.user_agent,
    request_bytes: row.request_bytes,
    response_bytes: row.response_bytes,
    ...(includeBodies ? {
      api_key: { name: row.api_key_name, prefix: row.api_key_prefix },
      request_body: parseBody(row.request_body_json),
      response_body: parseBody(row.response_body_json),
    } : {}),
  };
}

function parseBody(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

const logColumns = 'id,api_key_name,api_key_prefix,endpoint,method,response_status,user_agent,request_bytes,response_bytes,request_body_json,response_body_json,created_at';

export async function listApiLogs(_apiKeyId: string, url: URL) {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'limit must be an integer from 1 to 100.' } as const;
  const after = url.searchParams.get('after');
  const before = url.searchParams.get('before');
  if (after !== null && before !== null) return { error: 'Use either after or before, not both.' } as const;
  let rows: ApiLogRow[];
  if (after !== null || before !== null) {
    const cursorId = after ?? before;
    if (!cursorId) return { error: `${after !== null ? 'after' : 'before'} must be a non-empty log ID.` } as const;
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM api_request_logs WHERE id=?', [cursorId]);
    if (!cursor) return { error: 'The cursor must be an existing log ID.' } as const;
    const direction = after !== null ? '<' : '>';
    const order = after !== null ? 'DESC' : 'ASC';
    rows = (await query<ApiLogRow>(`SELECT ${logColumns} FROM api_request_logs
      WHERE (created_at ${direction} ? OR (created_at = ? AND id ${direction} ?))
      ORDER BY created_at ${order},id ${order} LIMIT ?`, [cursor.created_at, cursor.created_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<ApiLogRow>(`SELECT ${logColumns} FROM api_request_logs ORDER BY created_at DESC,id DESC LIMIT ?`, [limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  if (before !== null) data.reverse();
  return { data: data.map((row) => toLog(row)), has_more: hasMore, ...(hasMore ? { [before !== null ? 'next_before' : 'next_after']: data[data.length - 1]?.id } : {}) } as const;
}

export async function getApiLog(id: string) {
  const row = await queryOne<ApiLogRow>(`SELECT ${logColumns} FROM api_request_logs WHERE id=?`, [id]);
  return row ? toLog(row, true) : null;
}

export async function listDashboardApiLogs(url: URL) {
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'limit must be an integer from 1 to 100.' } as const;
  const search = url.searchParams.get('search')?.trim().slice(0, 100) ?? '';
  const rawStatus = url.searchParams.get('status') ?? '';
  const status = rawStatus && rawStatus !== 'errors' && rawStatus !== 'success' ? Number(rawStatus) : rawStatus;
  if (typeof status === 'number' && (!Number.isInteger(status) || status < 100 || status > 599)) return { error: 'status must be errors, success, or an HTTP status from 100 to 599.' } as const;
  const after = url.searchParams.get('after');
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (search) { clauses.push('(id LIKE ? OR endpoint LIKE ? OR method LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status === 'errors') clauses.push('response_status >= 400');
  else if (status === 'success') clauses.push('response_status < 400');
  else if (typeof status === 'number') { clauses.push('response_status = ?'); params.push(status); }
  if (after) {
    const cursor = await queryOne<{ id: string; created_at: string }>('SELECT id,created_at FROM api_request_logs WHERE id=?', [after]);
    if (!cursor) return { error: 'after must be an existing log ID.' } as const;
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))'); params.push(cursor.created_at, cursor.created_at, cursor.id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await query<ApiLogRow>(`SELECT ${logColumns} FROM api_request_logs ${where} ORDER BY created_at DESC,id DESC LIMIT ?`, [...params, limit + 1])).rows;
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const count = await query<{ total: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS total FROM api_request_logs ${where}`, params);
  return { data: data.map((row) => toLog(row)), total: count.rows[0]?.total ?? 0, has_more: hasMore, ...(hasMore ? { next_after: data[data.length - 1]?.id } : {}) } as const;
}

export async function getDashboardApiLog(id: string) {
  return await getApiLog(id);
}
