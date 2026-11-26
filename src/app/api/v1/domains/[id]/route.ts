import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type DomainContext = { params: Promise<{ id: string }> };
type DomainRow = { id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null; open_tracking: number; click_tracking: number };

function apiError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

async function authorize(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: apiError('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: apiError('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request, context: DomainContext) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const domain = await queryOne<DomainRow>('SELECT id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking FROM domains WHERE id=?', [id]);
  return domain ? NextResponse.json(domain, { headers: privateHeaders }) : apiError('Sender domain not found.', 404);
}

async function __emailgo_PATCH_handler(request: Request, context: DomainContext) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const domain = await queryOne<DomainRow>('SELECT id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking FROM domains WHERE id=?', [id]);
  if (!domain) return apiError('Sender domain not found.', 404);
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return apiError(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return apiError('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((name) => !['open_tracking', 'click_tracking'].includes(name))) return apiError('Only open_tracking and click_tracking can be updated.', 400);
  if (Object.values(body).some((value) => typeof value !== 'boolean')) return apiError('Tracking settings must be booleans.', 400);
  const openTracking = body.open_tracking === undefined ? Boolean(domain.open_tracking) : body.open_tracking;
  const clickTracking = body.click_tracking === undefined ? Boolean(domain.click_tracking) : body.click_tracking;
  if ((openTracking || clickTracking) && !domain.verified_at) return apiError('Verify this sender domain before enabling tracking.', 409);
  if ((openTracking || clickTracking) && (!process.env.EMAILGO_PUBLIC_URL || !process.env.EMAILGO_TRACKING_SECRET)) return apiError('Tracking requires EMAILGO_PUBLIC_URL and EMAILGO_TRACKING_SECRET on this deployment.', 503);
  await execute('UPDATE domains SET open_tracking=?,click_tracking=? WHERE id=?', [openTracking ? 1 : 0, clickTracking ? 1 : 0, id]);
  return NextResponse.json({ id, domain: domain.domain, open_tracking: openTracking, click_tracking: clickTracking }, { headers: privateHeaders });
}

async function __emailgo_DELETE_handler(request: Request, context: DomainContext) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const existing = await queryOne<{ id: string }>('SELECT id FROM domains WHERE id=?', [id]);
  if (!existing) return apiError('Sender domain not found.', 404);
  const keys = await queryOne<{ count: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM api_keys WHERE domain_id=? AND revoked_at IS NULL', [id]);
  if ((keys?.count ?? 0) > 0) return apiError('Revoke or remove domain-restricted API keys before deleting this sender domain.', 409);
  await execute('DELETE FROM domains WHERE id=?', [id]);
  return NextResponse.json({ id, deleted: true }, { headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
