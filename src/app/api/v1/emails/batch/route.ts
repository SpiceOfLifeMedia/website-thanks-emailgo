import { withApiRequestLog } from '@/lib/request-logs';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeApiKey } from '@/lib/auth';
import { consumeSendLimit } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { sendEmailRequest } from '../route';
import { withSendRateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

type BatchItem = { idempotency_key?: unknown; [key: string]: unknown };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7E]{1,256}$/.test(value);
}

async function __emailgo_POST_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);

  const parsed = await readJsonLimited(request, 1_000_000);
  if (!parsed.ok) return errorResponse(parsed.error, parsed.status);
  const body = parsed.value;
  const emails = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { emails?: unknown }).emails
      : undefined;
  if (!Array.isArray(emails) || emails.length === 0 || emails.length > 100) return errorResponse('emails must contain between 1 and 100 messages per batch.', 400);
  if (!emails.every((email) => email && typeof email === 'object' && !Array.isArray(email))) return errorResponse('Each batch item must be an email object.', 400);

  const requestIdempotencyKey = request.headers.get('idempotency-key');
  if (requestIdempotencyKey !== null && !validIdempotencyKey(requestIdempotencyKey)) return errorResponse('Idempotency-Key must be 1 to 256 visible ASCII characters.', 400);
  for (const [index, email] of emails.entries()) {
    const key = (email as BatchItem).idempotency_key;
    if (key !== undefined && !validIdempotencyKey(key)) return errorResponse(`emails[${index}].idempotency_key must be 1 to 256 visible ASCII characters.`, 400);
  }
  const rateLimit = await consumeSendLimit(apiKey.id);
  if (!rateLimit.allowed) return withSendRateLimitHeaders(errorResponse('Rate limit exceeded. Try again in the next minute.', 429), rateLimit);

  const authorization = request.headers.get('authorization') ?? '';
  const results: Array<Record<string, unknown>> = new Array(emails.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(5, emails.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= emails.length) return;
      const item = emails[index] as BatchItem;
      const { idempotency_key: itemIdempotencyKey, ...email } = item;
      const idempotencyKey = itemIdempotencyKey ?? (requestIdempotencyKey
        ? createHash('sha256').update(`${requestIdempotencyKey}\0${index}`).digest('hex')
        : null);
      const headers = new Headers({ authorization, 'content-type': 'application/json' });
      if (idempotencyKey) headers.set('idempotency-key', idempotencyKey as string);
      const singleRequest = new Request(new URL('/api/v1/emails', request.url), { method: 'POST', headers, body: JSON.stringify(email) });
      try {
        const response = await sendEmailRequest(singleRequest, { countRateLimit: false, apiKey });
        const payload = await response.json().catch(() => ({}));
        results[index] = { index, http_status: response.status, ...payload };
      } catch {
        results[index] = { index, http_status: 500, error: { message: 'Unexpected error while processing this batch item.' } };
      }
    }
  });
  await Promise.all(workers);

  const hasFailures = results.some((result) => typeof result.http_status === 'number' && (result.http_status < 200 || result.http_status >= 300));
  return withSendRateLimitHeaders(NextResponse.json({ data: results, has_failures: hasFailures }, { status: hasFailures ? 207 : 200 }), rateLimit);
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
