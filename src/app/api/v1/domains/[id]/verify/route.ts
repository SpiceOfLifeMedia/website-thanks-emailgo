import { withApiRequestLog } from '@/lib/request-logs';
import { resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { publicVerificationToken, verificationRecordHosts } from '@/lib/domain-verification';
import { domainWebhookData } from '@/lib/domain-webhook';
import { emitWebhookEventToAllSubscribers } from '@/lib/webhooks';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const domain = await queryOne<{ id: string; domain: string; verification_token: string; created_at: string }>('SELECT id,domain,verification_token,created_at FROM domains WHERE id=?', [id]);
  if (!domain) return NextResponse.json({ error: { message: 'Sender domain not found.' } }, { status: 404, headers: privateHeaders });
  try {
    const brandedToken = publicVerificationToken(domain.verification_token);
    const hosts = verificationRecordHosts(domain.domain, domain.verification_token);
    const results = await Promise.allSettled(hosts.map((host) => resolveTxt(host)));
    const verified = results.some((result) => result.status === 'fulfilled' && result.value.some((parts) => [domain.verification_token, brandedToken].includes(parts.join(''))));
    if (!verified) return NextResponse.json({ verified: false, error: { message: `TXT record not found at _send-thanks.${domain.domain}.` } }, { status: 422, headers: privateHeaders });
    const verifiedAt = nowIso();
    await execute('UPDATE domains SET verified_at=? WHERE id=?', [verifiedAt, id]);
    await emitWebhookEventToAllSubscribers('domain.updated', domainWebhookData({ ...domain, verified_at: verifiedAt }), `domain.updated:${id}:${verifiedAt}`);
    return NextResponse.json({ id, verified: true, verified_at: verifiedAt }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ verified: false, error: { message: `Could not find a TXT record at _send-thanks.${domain.domain}.` } }, { status: 422, headers: privateHeaders });
  }
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
