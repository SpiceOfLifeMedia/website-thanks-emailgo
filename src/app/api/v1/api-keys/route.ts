import { withApiRequestLog } from '@/lib/request-logs';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, hashSecret, nowIso, query, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

function apiError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

async function __emailgo_GET_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return apiError('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return apiError('This API key has sending-only access.', 403);
  const result = await query(`SELECT id,name,prefix,permission,domain_id,created_at,last_used_at FROM api_keys WHERE workspace_id=? AND revoked_at IS NULL ORDER BY created_at DESC,id DESC`, [key.workspaceId]);
  return NextResponse.json({ data: result.rows }, { headers: privateHeaders });
}

async function __emailgo_POST_handler(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return apiError('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return apiError('This API key has sending-only access.', 403);
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return apiError(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return apiError('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).some((name) => !['name', 'permission', 'domain_id'].includes(name))) return apiError('Only name, permission and domain_id are supported.', 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80 || /[\r\n]/.test(name)) return apiError('Name must be 1 to 80 single-line characters.', 400);
  const permission = body.permission === undefined ? 'full_access' : body.permission;
  if (permission !== 'full_access' && permission !== 'sending_access') return apiError('permission must be full_access or sending_access.', 400);
  const domainId = body.domain_id === undefined || body.domain_id === null || body.domain_id === '' ? null : typeof body.domain_id === 'string' ? body.domain_id : '';
  if (domainId === '') return apiError('domain_id must be a sender domain ID.', 400);
  if (permission === 'sending_access' && !domainId) return apiError('Sending-only API keys must be restricted to a verified sender domain.', 400);
  if (permission === 'full_access' && domainId) return apiError('domain_id can only be used with sending_access keys.', 400);
  if (domainId) {
    const domain = await queryOne<{ id: string }>('SELECT id FROM domains WHERE id=? AND workspace_id=? AND verified_at IS NOT NULL', [domainId, key.workspaceId]);
    if (!domain) return apiError('Choose an existing verified sender domain.', 400);
  }
  const secret = `st_live_${randomBytes(32).toString('base64url')}`;
  const id = randomId('key');
  const createdAt = nowIso();
  const prefix = secret.slice(0, 20);
  await execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,permission,domain_id,workspace_id) VALUES(?,?,?,?,?,?,?,?)', [id, name, prefix, hashSecret(secret), createdAt, permission, domainId, key.workspaceId]);
  return NextResponse.json({ id, name, prefix, permission, domain_id: domainId, secret, created_at: createdAt }, { status: 201, headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const POST = withApiRequestLog(__emailgo_POST_handler);
