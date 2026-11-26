import { withApiRequestLog } from '@/lib/request-logs';
import { resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const domain = await queryOne<{ id: string; domain: string; verification_token: string }>('SELECT id,domain,verification_token FROM domains WHERE id=?', [id]);
  if (!domain) return NextResponse.json({ error: { message: 'Sender domain not found.' } }, { status: 404, headers: privateHeaders });
  try {
    const records = await resolveTxt(`_emailgo.${domain.domain}`);
    const verified = records.some((parts) => parts.join('') === domain.verification_token);
    if (!verified) return NextResponse.json({ verified: false, error: { message: `TXT record not found at _emailgo.${domain.domain}.` } }, { status: 422, headers: privateHeaders });
    const verifiedAt = nowIso();
    await execute('UPDATE domains SET verified_at=? WHERE id=?', [verifiedAt, id]);
    return NextResponse.json({ id, verified: true, verified_at: verifiedAt }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ verified: false, error: { message: `Could not find a TXT record at _emailgo.${domain.domain}.` } }, { status: 422, headers: privateHeaders });
  }
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
