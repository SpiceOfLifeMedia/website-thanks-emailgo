import { NextResponse } from 'next/server';
import { configured } from '@/lib/resend';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: true, provider: 'Resend', configured: configured() });
}
