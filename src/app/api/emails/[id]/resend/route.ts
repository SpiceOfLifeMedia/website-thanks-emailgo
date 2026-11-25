import { NextResponse } from 'next/server';
import { configured, resendEmail } from '@/lib/resend';
export const dynamic = 'force-dynamic';
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!configured()) return NextResponse.json({ error: 'Configure RESEND_API_KEY and RESEND_FROM first.' }, { status: 503 });
  const { id } = await params;
  if (!/^\S{1,200}$/.test(id)) return NextResponse.json({ error: 'Invalid email id.' }, { status: 400 });
  try { return NextResponse.json({ ok: true, result: await resendEmail(id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Resend failed.' }, { status: 502 }); }
}
