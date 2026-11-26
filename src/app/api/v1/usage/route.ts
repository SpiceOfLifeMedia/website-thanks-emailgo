import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query } from '@/lib/database';

export const runtime = 'nodejs';
function period(window: 'daily' | 'monthly') {
  const now = new Date();
  if (window === 'daily') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const reset = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), resets_at: reset.toISOString() };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), resets_at: reset.toISOString() };
}

export async function GET(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const [dailyWindow, monthlyWindow] = [period('daily'), period('monthly')];
  const [daily, monthly, contacts, domains, webhooks, segments, topics] = await Promise.all([
    query(`SELECT CAST(COUNT(*) AS INTEGER) AS used,CAST(COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),0) AS INTEGER) AS sent,
      CAST(COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS INTEGER) AS failed FROM emails WHERE created_at>=?`, [dailyWindow.start]),
    query(`SELECT CAST(COUNT(*) AS INTEGER) AS used,CAST(COALESCE(SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),0) AS INTEGER) AS sent,
      CAST(COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS INTEGER) AS failed FROM emails WHERE created_at>=?`, [monthlyWindow.start]),
    query('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM contacts'),
    query('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM domains'),
    query('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM webhooks WHERE disabled_at IS NULL'),
    query('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM segments'),
    query('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM topics WHERE disabled_at IS NULL'),
  ]);
  return NextResponse.json({
    object: 'usage',
    emails: {
      daily: { ...daily.rows[0], limit: null, resets_at: dailyWindow.resets_at },
      monthly: { ...monthly.rows[0], limit: null, resets_at: monthlyWindow.resets_at },
    },
    contacts: { ...contacts.rows[0], limit: null },
    domains: { ...domains.rows[0], limit: null },
    webhooks: { ...webhooks.rows[0], limit: 50 },
    segments: { ...segments.rows[0], limit: null },
    topics: { ...topics.rows[0], limit: null },
    rate_limit: { limit: 60, duration: '60000ms', applies_to: 'send requests per API key' },
  });
}
