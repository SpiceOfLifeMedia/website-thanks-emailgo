import { NextResponse } from 'next/server';
import { isAdminSession, hasAdminSetup } from '@/lib/auth';
import { query } from '@/lib/database';
import { smtpConfigured } from '@/lib/smtp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasAdminSetup()) return NextResponse.json({ setupRequired: true, error: 'Set EMAILGO_ADMIN_PASSWORD and EMAILGO_SESSION_SECRET before signing in.' }, { status: 503 });
  if (!await isAdminSession()) return NextResponse.json({ authenticated: false, error: 'Sign in required.' }, { status: 401 });

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [emailResult, keyResult, domainResult, metricResult, monthResult, blockResult, suppressionResult] = await Promise.all([
    query('SELECT id, from_address AS "from", to_json, subject, status, created_at FROM emails ORDER BY created_at DESC LIMIT 50'),
    query('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC'),
    query<{ id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null }>('SELECT id, domain, verification_token, created_at, verified_at FROM domains ORDER BY created_at DESC'),
    query(`SELECT
      CAST(COUNT(*) AS INTEGER) AS total,
      CAST(COALESCE(SUM(CASE WHEN status IN ('sent','deferred','delivered','bounced','complained') THEN 1 ELSE 0 END), 0) AS INTEGER) AS sent,
      CAST(COALESCE(SUM(CASE WHEN status IN ('bounced','complained') THEN 1 ELSE 0 END), 0) AS INTEGER) AS bounced,
      CAST(COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS INTEGER) AS failed
      FROM emails WHERE created_at >= ?`, [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]),
    query<{ month_to_date: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS month_to_date FROM emails WHERE created_at >= ?', [monthStart.toISOString()]),
    query<{ address: string; reason: string; added_at: string }>('SELECT address, reason, added_at FROM blocked_addresses ORDER BY added_at DESC'),
    query<{ address: string; reason: string; added_at: string }>("SELECT address, reason, created_at AS added_at FROM suppressions ORDER BY created_at DESC"),
  ]);

  const domains = domainResult.rows.map((domain) => ({
    ...domain,
    verification_token: domain.verification_token.startsWith('emailgo-verify=')
      ? domain.verification_token.replace(/^emailgo-verify=/, 'send-thanks-verify=')
      : domain.verification_token,
  }));
  const blockedByAddress = new Map<string, { address: string; reason: string; added_at: string; removable: boolean }>();
  for (const entry of blockResult.rows) blockedByAddress.set(entry.address, { ...entry, removable: true });
  for (const entry of suppressionResult.rows) blockedByAddress.set(entry.address, { ...entry, removable: false });
  const blockedAddresses = [...blockedByAddress.values()].sort((left, right) => right.added_at.localeCompare(left.added_at));

  return NextResponse.json({
    authenticated: true,
    smtpConfigured: smtpConfigured(),
    emails: emailResult.rows.map((email) => ({ ...email, to: JSON.parse(String(email.to_json)) })),
    keys: keyResult.rows,
    domains,
    blockedAddresses,
    metrics: { ...metricResult.rows[0], monthToDate: monthResult.rows[0]?.month_to_date ?? 0 },
  });
}
