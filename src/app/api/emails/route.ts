import { NextResponse } from 'next/server';
import { configured, listEmails } from '@/lib/resend';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!configured()) return NextResponse.json({ configured: false, data: [] });
  try { return NextResponse.json({ configured: true, data: await listEmails() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load emails.' }, { status: 502 }); }
}
