import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, hashSecret, nowIso, queryOne, randomId } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { DEFAULT_WORKSPACE_ID } from '@/lib/workspaces';

export const runtime = 'nodejs';

export async function DELETE(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 24_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });

  const body = parsed.value as { ids?: unknown; confirmation?: unknown };
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 120 || !body.ids.every((id) => typeof id === 'string' && /^key_[a-f0-9]{24}$/.test(id))) {
    return NextResponse.json({ error: 'ids must contain between 1 and 120 valid API key IDs.' }, { status: 400 });
  }
  if (body.confirmation !== 'REVOKE API KEYS') return NextResponse.json({ error: 'Type REVOKE API KEYS to confirm this action.' }, { status: 400 });

  const ids = [...new Set(body.ids as string[])];
  const placeholders = ids.map(() => '?').join(',');
  const revoked = await execute(`UPDATE api_keys SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL AND id IN (${placeholders})`, [nowIso(), DEFAULT_WORKSPACE_ID, ...ids]);
  return NextResponse.json({ object: 'list', revoked, requested: ids.length }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as Record<string, unknown>;
  const name = body.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return NextResponse.json({ error: 'Name must be 1 to 80 characters.' }, { status: 400 });
  const permission = body.permission === undefined ? 'full_access' : body.permission;
  if (permission !== 'full_access' && permission !== 'sending_access') return NextResponse.json({ error: 'permission must be full_access or sending_access.' }, { status: 400 });
  const domainId = body.domain_id === undefined || body.domain_id === null || body.domain_id === '' ? null : typeof body.domain_id === 'string' ? body.domain_id : '';
  if (domainId === '') return NextResponse.json({ error: 'domain_id must be a sender domain ID.' }, { status: 400 });
  if (permission === 'sending_access' && !domainId) return NextResponse.json({ error: 'Sending-only API keys must be restricted to a verified sender domain.' }, { status: 400 });
  if (permission === 'full_access' && domainId) return NextResponse.json({ error: 'domain_id can only be used with sending_access keys.' }, { status: 400 });
  if (domainId) {
    const domain = await queryOne<{ id: string }>('SELECT id FROM domains WHERE id=? AND workspace_id=? AND verified_at IS NOT NULL', [domainId, DEFAULT_WORKSPACE_ID]);
    if (!domain) return NextResponse.json({ error: 'Choose an existing verified sender domain.' }, { status: 400 });
  }
  const secret = `st_live_${randomBytes(32).toString('base64url')}`;
  const id = randomId('key');
  const createdAt = nowIso();
  const prefix = secret.slice(0, 20);
  await execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,permission,domain_id,workspace_id) VALUES(?,?,?,?,?,?,?,?)', [id, name.trim(), prefix, hashSecret(secret), createdAt, permission, domainId, DEFAULT_WORKSPACE_ID]);
  return NextResponse.json({ id, name: name.trim(), prefix, permission, domain_id: domainId, secret, created_at: createdAt }, { status: 201 });
}
