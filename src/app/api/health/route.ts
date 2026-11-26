import { NextResponse } from 'next/server';
import { smtpConfigured } from '@/lib/smtp';
import { query } from '@/lib/database';
export const runtime = 'nodejs';
export async function GET() {
  try {
    await query('SELECT 1 AS ok');
    return NextResponse.json({ ok: true, service: 'Emailgo', database: 'connected', smtpConfigured: smtpConfigured() });
  } catch {
    return NextResponse.json({ ok: false, service: 'Emailgo', database: 'unavailable', smtpConfigured: smtpConfigured() }, { status: 503 });
  }
}
