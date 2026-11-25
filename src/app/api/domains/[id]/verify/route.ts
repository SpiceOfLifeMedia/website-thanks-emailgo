import { resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { getDatabase, nowIso } from '@/lib/database';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const database = getDatabase();
  const domain = database.prepare('SELECT id,domain,verification_token FROM domains WHERE id = ?').get(id) as { id: string; domain: string; verification_token: string } | undefined;
  if (!domain) return NextResponse.json({ error: 'Sender domain not found.' }, { status: 404 });
  try {
    const records = await resolveTxt(`_emailgo.${domain.domain}`);
    const verified = records.some((parts) => parts.join('') === domain.verification_token);
    if (!verified) return NextResponse.json({ verified: false, error: `TXT record not found at _emailgo.${domain.domain}.` }, { status: 422 });
    database.prepare('UPDATE domains SET verified_at = ? WHERE id = ?').run(nowIso(), id);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ verified: false, error: `Could not find a TXT record at _emailgo.${domain.domain}.` }, { status: 422 });
  }
}
