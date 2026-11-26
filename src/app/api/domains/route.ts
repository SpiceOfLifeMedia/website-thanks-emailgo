import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, randomId } from '@/lib/database';
import { randomBytes } from 'node:crypto';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const domainValue = body && typeof body === 'object' && 'domain' in body ? (body as { domain?: unknown }).domain : undefined;
  if (typeof domainValue !== 'string') return NextResponse.json({ error: 'Enter a sender domain.' }, { status: 400 });
  const domain = domainValue.trim().toLowerCase().replace(/\.$/, '');
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/.test(domain)) return NextResponse.json({ error: 'Enter a valid domain name.' }, { status: 400 });
  const token = `send-thanks-verify=${randomBytes(24).toString('hex')}`;
  const id = randomId('dom');
  try { await execute('INSERT INTO domains(id,domain,verification_token,created_at) VALUES(?,?,?,?)', [id, domain, token, nowIso()]); }
  catch { return NextResponse.json({ error: 'That sender domain is already added.' }, { status: 409 }); }
  return NextResponse.json({ id, domain, verification_token: token, created_at: nowIso(), open_tracking: false, click_tracking: false }, { status: 201 });
}
