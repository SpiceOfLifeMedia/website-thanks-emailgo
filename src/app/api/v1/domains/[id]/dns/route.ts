import { withApiRequestLog } from '@/lib/request-logs';
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

async function txtRecords(host: string) {
  try { return (await resolveTxt(host)).map((parts) => parts.join('')); }
  catch { return []; }
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const domain = await queryOne<{ id: string; domain: string }>('SELECT id,domain FROM domains WHERE id=?', [id]);
  if (!domain) return NextResponse.json({ error: { message: 'Sender domain not found.' } }, { status: 404, headers: privateHeaders });
  const [rootTxt, dmarcTxt, mxRecords] = await Promise.all([
    txtRecords(domain.domain),
    txtRecords(`_dmarc.${domain.domain}`),
    resolveMx(domain.domain).catch(() => []),
  ]);
  const spf = rootTxt.filter((record) => /^v=spf1(?:\s|$)/i.test(record));
  const dmarc = dmarcTxt.filter((record) => /^v=DMARC1(?:\s|$)/i.test(record));
  return NextResponse.json({
    domain: domain.domain,
    checked_at: new Date().toISOString(),
    records: {
      ownership: { status: 'see_domain_verification', host: `_emailgo.${domain.domain}` },
      spf: { status: spf.length === 1 ? 'found' : spf.length > 1 ? 'multiple' : 'missing', host: domain.domain, values: spf },
      dmarc: { status: dmarc.length === 1 ? 'found' : dmarc.length > 1 ? 'multiple' : 'missing', host: `_dmarc.${domain.domain}`, values: dmarc },
      mx: { status: mxRecords.length ? 'found' : 'missing', values: mxRecords.map(({ exchange, priority }) => ({ host: exchange, priority })) },
      dkim: { status: 'relay_managed', message: 'Publish the DKIM record supplied by the configured SMTP relay. Emailgo does not generate or sign DKIM keys yet.' },
    },
  }, { headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
