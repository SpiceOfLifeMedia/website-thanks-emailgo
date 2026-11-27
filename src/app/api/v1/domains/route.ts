import { withApiRequestLog } from '@/lib/request-logs';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, query, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { publicVerificationToken } from '@/lib/domain-verification';
import { domainWebhookData } from '@/lib/domain-webhook';
import { emitWebhookEventToAllSubscribers } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

function apiError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: apiError('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: apiError('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const result = await query<{ verification_token: string } & Record<string, unknown>>(`SELECT id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking FROM domains ORDER BY created_at DESC,id DESC`);
  return NextResponse.json({ data: result.rows.map((domain) => ({ ...domain, verification_token: publicVerificationToken(domain.verification_token) })) }, { headers: privateHeaders });
}

async function __emailgo_POST_handler(request: Request) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return apiError(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return apiError('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.domain !== 'string') return apiError('Only domain is supported.', 400);
  const domain = body.domain.trim().toLowerCase().replace(/\.$/, '');
  if (!domainPattern.test(domain)) return apiError('Enter a valid sender domain.', 400);
  const verificationToken = `send-thanks-verify=${randomBytes(24).toString('hex')}`;
  const id = randomId('dom');
  const createdAt = nowIso();
  try {
    await execute('INSERT INTO domains(id,domain,verification_token,created_at) VALUES(?,?,?,?)', [id, domain, verificationToken, createdAt]);
  } catch {
    return apiError('That sender domain is already added.', 409);
  }
  await emitWebhookEventToAllSubscribers('domain.created', domainWebhookData({ id, domain, created_at: createdAt, verified_at: null }), `domain.created:${id}`);
  return NextResponse.json({ id, domain, verification_token: verificationToken, created_at: createdAt, verified_at: null, open_tracking: false, click_tracking: false }, { status: 201, headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
