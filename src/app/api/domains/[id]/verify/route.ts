import { resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const domain = await queryOne<{ id: string; domain: string; verification_token: string }>('SELECT id,domain,verification_token FROM domains WHERE id = ?', [id]);
  if (!domain) return NextResponse.json({ error: 'Sender domain not found.' }, { status: 404 });
  try {
    const records = await resolveTxt(`_emailgo.${domain.domain}`);
    const verified = records.some((parts) => parts.join('') === domain.verification_token);
    if (!verified) return NextResponse.json({ verified: false, error: `TXT record not found at _emailgo.${domain.domain}.` }, { status: 422 });
    await execute('UPDATE domains SET verified_at = ? WHERE id = ?', [nowIso(), id]);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ verified: false, error: `Could not find a TXT record at _emailgo.${domain.domain}.` }, { status: 422 });
  }
}
