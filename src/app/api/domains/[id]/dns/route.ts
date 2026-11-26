import { resolveMx, resolveTxt } from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function txtRecords(host: string) {
  try { return { records: (await resolveTxt(host)).map((parts) => parts.join('')) as string[], lookup: 'complete' as const }; }
  catch { return { records: [] as string[], lookup: 'missing' as const }; }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const domain = await queryOne<{ id: string; domain: string }>('SELECT id,domain FROM domains WHERE id=?', [id]);
  if (!domain) return NextResponse.json({ error: 'Sender domain not found.' }, { status: 404 });

  const [rootTxt, dmarcTxt, mxResult] = await Promise.all([
    txtRecords(domain.domain),
    txtRecords(`_dmarc.${domain.domain}`),
    resolveMx(domain.domain).then((records) => ({ records, lookup: 'complete' as const })).catch(() => ({ records: [], lookup: 'missing' as const })),
  ]);
  const spfRecords = rootTxt.records.filter((record) => /^v=spf1(?:\s|$)/i.test(record));
  const dmarcRecords = dmarcTxt.records.filter((record) => /^v=DMARC1(?:\s|$)/i.test(record));
  return NextResponse.json({
    domain: domain.domain,
    checked_at: new Date().toISOString(),
    records: {
      ownership: { status: 'see_domain_verification', host: `_send-thanks.${domain.domain}` },
      spf: { status: spfRecords.length === 1 ? 'found' : spfRecords.length > 1 ? 'multiple' : 'missing', host: domain.domain, values: spfRecords },
      dmarc: { status: dmarcRecords.length === 1 ? 'found' : dmarcRecords.length > 1 ? 'multiple' : 'missing', host: `_dmarc.${domain.domain}`, values: dmarcRecords },
      mx: { status: mxResult.records.length ? 'found' : 'missing', values: mxResult.records.map(({ exchange, priority }) => ({ host: exchange, priority })) },
      dkim: { status: 'relay_managed', message: 'Publish the DKIM record supplied by the configured SMTP relay. Send, thanks does not generate or sign DKIM keys yet.' },
    },
  });
}
