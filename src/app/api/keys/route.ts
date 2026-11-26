import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, hashSecret, nowIso, randomId } from '@/lib/database';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const name = body && typeof body === 'object' && 'name' in body ? (body as { name?: unknown }).name : undefined;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return NextResponse.json({ error: 'Name must be 1 to 80 characters.' }, { status: 400 });
  const secret = `st_live_${randomBytes(32).toString('base64url')}`;
  const id = randomId('key');
  const createdAt = nowIso();
  const prefix = secret.slice(0, 20);
  await execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', [id, name.trim(), prefix, hashSecret(secret), createdAt]);
  return NextResponse.json({ id, name: name.trim(), prefix, secret, created_at: createdAt }, { status: 201 });
}
