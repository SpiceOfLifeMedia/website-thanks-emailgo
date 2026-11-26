import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso } from '@/lib/database';

export const runtime = 'nodejs';

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const value = body && typeof body === 'object' && 'address' in body ? (body as { address?: unknown }).address : undefined;
  if (typeof value !== 'string' || value.length > 254 || !emailPattern.test(value.trim())) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  const address = value.trim().toLowerCase();
  try {
    const addedAt = nowIso();
    await execute('INSERT INTO blocked_addresses(address,reason,added_at) VALUES(?,?,?)', [address, 'manual', addedAt]);
    return NextResponse.json({ address, reason: 'manual', added_at: addedAt }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'That address is already on the block list.' }, { status: 409 });
  }
}
