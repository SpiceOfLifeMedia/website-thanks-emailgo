import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { adminCookie, createAdminSession, hasAdminSetup, hasTrustedBrowserOrigin, sessionMaxAge, verifyAdminPassword } from '@/lib/auth';
import { consumeLoginAttempt } from '@/lib/database';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!hasAdminSetup()) return NextResponse.json({ error: 'Set EMAILGO_ADMIN_PASSWORD and EMAILGO_SESSION_SECRET before signing in.' }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const source = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'local';
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (!consumeLoginAttempt(sourceHash)) return NextResponse.json({ error: 'Too many sign in attempts. Try again in a minute.' }, { status: 429 });
  const password = body && typeof body === 'object' && 'password' in body ? (body as { password?: unknown }).password : undefined;
  if (typeof password !== 'string' || password.length > 512 || !verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'The admin password did not match.' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminCookie, createAdminSession(), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionMaxAge });
  return response;
}
