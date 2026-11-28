import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { getDashboardApiLog } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in to view API request logs.' }, { status: 401 });
  const { id } = await context.params;
  const log = await getDashboardApiLog(id);
  if (!log) return NextResponse.json({ error: { message: 'Log not found.' } }, { status: 404 });
  return NextResponse.json(log, { headers: { 'Cache-Control': 'private, no-store' } });
}
