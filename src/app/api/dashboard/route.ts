import { NextResponse } from 'next/server';
import { isAdminSession, hasAdminSetup } from '@/lib/auth';
import { query } from '@/lib/database';
import { smtpConfigured } from '@/lib/smtp';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!hasAdminSetup()) return NextResponse.json({ setupRequired: true, error: 'Set EMAILGO_ADMIN_PASSWORD and EMAILGO_SESSION_SECRET before signing in.' }, { status: 503 });
  if (!await isAdminSession()) return NextResponse.json({ authenticated: false }, { status: 401 });
  const [emailResult, keyResult, domainResult, metricResult] = await Promise.all([
    query('SELECT id, from_address AS "from", to_json, subject, status, error_message, provider_id, created_at FROM emails ORDER BY created_at DESC LIMIT 50'),
    query('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC'),
    query('SELECT id, domain, verification_token, created_at, verified_at FROM domains ORDER BY created_at DESC'),
    query(`SELECT
    CAST(COUNT(*) AS INTEGER) AS total,
    CAST(COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS INTEGER) AS sent,
    CAST(COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS INTEGER) AS failed
    FROM emails WHERE created_at >= ?`, [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]),
  ]);
  return NextResponse.json({ authenticated: true, smtpConfigured: smtpConfigured(), emails: emailResult.rows.map((email) => ({ ...email, to: JSON.parse(String(email.to_json)) })), keys: keyResult.rows, domains: domainResult.rows, metrics: metricResult.rows[0] });
}
