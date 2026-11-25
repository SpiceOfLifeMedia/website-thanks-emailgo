import { NextResponse } from 'next/server';
import { smtpConfigured } from '@/lib/smtp';
export const runtime = 'nodejs';
export async function GET() {
  return NextResponse.json({ ok: true, service: 'Emailgo', smtpConfigured: smtpConfigured() });
}
