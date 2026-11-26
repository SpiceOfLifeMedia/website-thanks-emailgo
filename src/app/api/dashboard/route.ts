import { NextResponse } from 'next/server';
import { isAdminSession, hasAdminSetup } from '@/lib/auth';
import { query } from '@/lib/database';
import { smtpConfigured } from '@/lib/smtp';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!hasAdminSetup()) return NextResponse.json({ setupRequired: true, error: 'Set EMAILGO_ADMIN_PASSWORD and EMAILGO_SESSION_SECRET before signing in.' }, { status: 503 });
  if (!await isAdminSession()) return NextResponse.json({ authenticated: false }, { status: 401 });
  const [emailResult, keyResult, domainResult, metricResult, eventMetricResult] = await Promise.all([
    query(`SELECT e.id, e.from_address AS "from", e.to_json, e.subject, e.status, e.error_message, e.provider_id, e.scheduled_at, e.created_at,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.opened') AS INTEGER) AS open_count,
      CAST((SELECT COUNT(*) FROM email_events v WHERE v.email_id=e.id AND v.type='email.clicked') AS INTEGER) AS click_count
      FROM emails e ORDER BY e.created_at DESC LIMIT 50`),
    query('SELECT id, name, prefix, permission, domain_id, created_at, last_used_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC'),
    query('SELECT id, domain, verification_token, created_at, verified_at, open_tracking, click_tracking FROM domains ORDER BY created_at DESC'),
    query(`SELECT
    CAST(COUNT(*) AS INTEGER) AS total,
    CAST(COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS INTEGER) AS sent,
    CAST(COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS INTEGER) AS failed
    FROM emails WHERE created_at >= ?`, [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]),
    query(`SELECT
      CAST(COALESCE(SUM(CASE WHEN type='email.opened' THEN 1 ELSE 0 END),0) AS INTEGER) AS opens,
      CAST(COALESCE(SUM(CASE WHEN type='email.clicked' THEN 1 ELSE 0 END),0) AS INTEGER) AS clicks
      FROM email_events WHERE created_at >= ?`, [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]),
  ]);
  return NextResponse.json({ authenticated: true, smtpConfigured: smtpConfigured(), scheduledSendsEnabled: Boolean(process.env.CRON_SECRET), trackingConfigured: Boolean(process.env.EMAILGO_PUBLIC_URL && process.env.EMAILGO_TRACKING_SECRET), webhookSigningConfigured: Boolean(process.env.EMAILGO_WEBHOOK_SECRET && process.env.EMAILGO_WEBHOOK_SECRET.length >= 32), preferencesConfigured: Boolean(process.env.EMAILGO_PREFERENCES_SECRET && process.env.EMAILGO_PREFERENCES_SECRET.length >= 32), emails: emailResult.rows.map((email) => ({ ...email, to: JSON.parse(String(email.to_json)) })), keys: keyResult.rows, domains: domainResult.rows.map((domain) => ({ ...domain, open_tracking: Boolean(domain.open_tracking), click_tracking: Boolean(domain.click_tracking) })), metrics: { ...metricResult.rows[0], ...eventMetricResult.rows[0] } });
}
