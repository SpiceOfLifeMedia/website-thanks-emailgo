import { NextResponse } from 'next/server';
import { isAdminSession, hasAdminSetup } from '@/lib/auth';
import { query } from '@/lib/database';
import { smtpConfigured } from '@/lib/smtp';
import { sanitizeCustomerCopy } from '@/lib/customer-copy';
import { publicVerificationToken } from '@/lib/domain-verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasAdminSetup()) return NextResponse.json({ setupRequired: true, error: 'Send, thanks is not configured for sign in.' }, { status: 503 });
  if (!await isAdminSession()) return NextResponse.json({ authenticated: false, error: 'Sign in required.' }, { status: 401 });

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [emailResult, keyResult, domainResult, metricResult, eventMetricResult, monthResult, suppressionResult] = await Promise.all([
    query(`SELECT e.id,e.from_address AS "from",e.to_json,e.subject,e.status,e.error_message,e.provider_id,e.scheduled_at,e.created_at,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.opened') AS INTEGER) AS open_count,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.clicked') AS INTEGER) AS click_count
      FROM emails e ORDER BY e.created_at DESC LIMIT 50`),
    query('SELECT id,name,prefix,permission,domain_id,created_at,last_used_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC'),
    query<{ id: string; domain: string; verification_token: string; created_at: string; verified_at: string | null; open_tracking: number; click_tracking: number }>(
      'SELECT id,domain,verification_token,created_at,verified_at,open_tracking,click_tracking FROM domains ORDER BY created_at DESC'),
    query(`SELECT
      CAST(COUNT(*) AS INTEGER) AS total,
      CAST(COALESCE(SUM(CASE WHEN status IN ('sent','deferred','delivered','bounced','complained') THEN 1 ELSE 0 END),0) AS INTEGER) AS sent,
      CAST(COALESCE(SUM(CASE WHEN status IN ('bounced','complained') THEN 1 ELSE 0 END),0) AS INTEGER) AS bounced,
      CAST(COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS INTEGER) AS failed
      FROM emails WHERE created_at>=?`, [dayStart]),
    query(`SELECT
      CAST(COALESCE(SUM(CASE WHEN type='email.opened' THEN 1 ELSE 0 END),0) AS INTEGER) AS opens,
      CAST(COALESCE(SUM(CASE WHEN type='email.clicked' THEN 1 ELSE 0 END),0) AS INTEGER) AS clicks
      FROM email_events WHERE created_at>=?`, [dayStart]),
    query<{ month_to_date: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS month_to_date FROM emails WHERE created_at>=?', [monthStart.toISOString()]),
    query<{ email: string; origin: string; created_at: string }>('SELECT email,origin,created_at FROM suppressions ORDER BY created_at DESC'),
  ]);

  const domains = domainResult.rows.map((domain) => ({
    ...domain,
    verification_token: publicVerificationToken(domain.verification_token),
    open_tracking: Boolean(domain.open_tracking),
    click_tracking: Boolean(domain.click_tracking),
  }));
  const blockedAddresses = suppressionResult.rows.map((entry) => ({
    address: entry.email,
    reason: entry.origin === 'bounce' ? 'bounced' : entry.origin === 'complaint' ? 'complained' : 'manual',
    added_at: entry.created_at,
    removable: entry.origin === 'manual',
  }));

  return NextResponse.json({
    authenticated: true,
    smtpConfigured: smtpConfigured(),
    scheduledSendsEnabled: Boolean(process.env.CRON_SECRET),
    trackingConfigured: Boolean(process.env.EMAILGO_PUBLIC_URL && process.env.EMAILGO_TRACKING_SECRET),
    webhookSigningConfigured: Boolean(process.env.EMAILGO_WEBHOOK_SECRET && process.env.EMAILGO_WEBHOOK_SECRET.length >= 32),
    preferencesConfigured: Boolean(process.env.EMAILGO_PREFERENCES_SECRET && process.env.EMAILGO_PREFERENCES_SECRET.length >= 32),
    emails: emailResult.rows.map((email) => ({
      ...email,
      error_message: typeof email.error_message === 'string' ? sanitizeCustomerCopy(email.error_message) : null,
      provider_id: typeof email.provider_id === 'string' ? sanitizeCustomerCopy(email.provider_id) : null,
      to: JSON.parse(String(email.to_json)),
    })),
    keys: keyResult.rows,
    domains,
    blockedAddresses,
    metrics: { ...metricResult.rows[0], ...eventMetricResult.rows[0], monthToDate: monthResult.rows[0]?.month_to_date ?? 0 },
  });
}
