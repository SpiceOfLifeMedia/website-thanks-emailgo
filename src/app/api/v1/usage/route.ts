import { withApiRequestLog } from '@/lib/request-logs';
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

async function count(table: 'contacts' | 'domains' | 'segments' | 'broadcasts', where = '', params: readonly (string | number)[] = []) {
  const result = await query<{ used: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS used FROM ${table} ${where}`, params);
  return Number(result.rows[0]?.used ?? 0);
}

async function emailCounts(start: string) {
  const [sentResult, receivedResult] = await Promise.all([
    query<{ used: number }>("SELECT CAST(COUNT(*) AS INTEGER) AS used FROM emails WHERE status='sent' AND created_at>=?", [start]),
    query<{ used: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM received_emails WHERE received_at>=?', [start]),
  ]);
  const sent = Number(sentResult.rows[0]?.used ?? 0);
  const received = Number(receivedResult.rows[0]?.used ?? 0);
  return { used: sent + received, limit: null, sent, received };
}

async function __emailgo_GET_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });

  const dailyWindow = period('daily');
  const monthlyWindow = period('monthly');
  const [daily, monthly, contacts, domains, segments, broadcasts, automationRuns] = await Promise.all([
    emailCounts(dailyWindow.start),
    emailCounts(monthlyWindow.start),
    count('contacts'),
    count('domains', 'WHERE workspace_id=?', [apiKey.workspaceId]),
    count('segments'),
    count('broadcasts'),
    query<{ used: number }>('SELECT CAST(COUNT(*) AS INTEGER) AS used FROM automation_runs WHERE started_at>=?', [monthlyWindow.start]),
  ]);
  return NextResponse.json({
    object: 'usage',
    emails: {
      daily: { ...daily, resets_at: dailyWindow.resets_at },
      monthly: { ...monthly, resets_at: monthlyWindow.resets_at },
    },
    contacts: { used: contacts, limit: null },
    segments: { used: segments, limit: null },
    broadcasts: { used: broadcasts, limit: null },
    domains: { used: domains, limit: null },
    automation_runs: { used: Number(automationRuns.rows[0]?.used ?? 0), limit: null, resets_at: monthlyWindow.resets_at },
    rate_limit: { limit: 10, duration: '1000ms', applies_to: 'authenticated API requests per workspace' },
  });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
