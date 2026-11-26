import { resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';

export const runtime = 'nodejs';

type StoredDomain = { id: string; domain: string; verification_token: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const domain = await queryOne<StoredDomain>('SELECT id,domain,verification_token FROM domains WHERE id = ?', [id]);
  if (!domain) return NextResponse.json({ error: 'Sender domain not found.' }, { status: 404 });

  const storedToken = domain.verification_token;
  const brandedToken = storedToken.startsWith('emailgo-verify=')
    ? storedToken.replace(/^emailgo-verify=/, 'send-thanks-verify=')
    : storedToken;
  const recordHosts = [`_send-thanks.${domain.domain}`];
  const expected = new Set([storedToken, brandedToken]);
  if (storedToken.startsWith('emailgo-verify=')) recordHosts.push(`_emailgo.${domain.domain}`);

  const results = await Promise.allSettled(recordHosts.map((host) => resolveTxt(host)));
  const found = results.some((result) => result.status === 'fulfilled'
    && result.value.some((parts) => expected.has(parts.join(''))));

  if (!found) return NextResponse.json({ verified: false, error: `Verification record not found at _send-thanks.${domain.domain}.` }, { status: 422 });
  await execute('UPDATE domains SET verified_at = ? WHERE id = ?', [nowIso(), id]);
  return NextResponse.json({ verified: true });
}
