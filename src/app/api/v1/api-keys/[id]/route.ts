import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type KeyContext = { params: Promise<{ id: string }> };

function apiError(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

async function requireFullAccess(request: Request) {
  const key = await authorizeApiKey(request);
  if (!key) return { error: apiError('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: apiError('This API key has sending-only access.', 403) };
  return { key };
}

async function __emailgo_GET_handler(request: Request, context: KeyContext) {
  const auth = await requireFullAccess(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const key = await queryOne<{ id: string; name: string; prefix: string; permission: string; domain_id: string | null; created_at: string; last_used_at: string | null }>('SELECT id,name,prefix,permission,domain_id,created_at,last_used_at FROM api_keys WHERE id=? AND workspace_id=? AND revoked_at IS NULL', [id, auth.key.workspaceId]);
  if (!key) return apiError('API key not found.', 404);
  return NextResponse.json(key, { headers: privateHeaders });
}

async function __emailgo_PATCH_handler(request: Request, context: KeyContext) {
  const auth = await requireFullAccess(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return apiError(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return apiError('Request body must be a JSON object.', 400);
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.name !== 'string') return apiError('Only name can be updated.', 400);
  const name = body.name.trim();
  if (!name || name.length > 80 || /[\r\n]/.test(name)) return apiError('Name must be 1 to 80 single-line characters.', 400);
  const updated = await execute('UPDATE api_keys SET name=? WHERE id=? AND workspace_id=? AND revoked_at IS NULL', [name, id, auth.key.workspaceId]);
  if (!updated) return apiError('API key not found.', 404);
  const key = await queryOne<{ id: string; name: string; prefix: string; permission: string; domain_id: string | null; created_at: string; last_used_at: string | null }>('SELECT id,name,prefix,permission,domain_id,created_at,last_used_at FROM api_keys WHERE id=? AND workspace_id=? AND revoked_at IS NULL', [id, auth.key.workspaceId]);
  return key ? NextResponse.json(key, { headers: privateHeaders }) : apiError('API key not found.', 404);
}

async function __emailgo_DELETE_handler(request: Request, context: KeyContext) {
  const auth = await requireFullAccess(request);
  if (auth.error) return auth.error;
  const { id } = await context.params;
  const revoked = await execute('UPDATE api_keys SET revoked_at=? WHERE id=? AND workspace_id=? AND revoked_at IS NULL', [nowIso(), id, auth.key.workspaceId]);
  return revoked ? NextResponse.json({ id, deleted: true }, { headers: privateHeaders }) : apiError('API key not found.', 404);
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
export const PATCH = withApiRequestLog(__emailgo_PATCH_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
