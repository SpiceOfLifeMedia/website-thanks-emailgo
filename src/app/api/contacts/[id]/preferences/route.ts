import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { createContactPreferenceToken } from '@/lib/contact-preferences';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers });
  const { id } = await context.params;
  const contact = await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [id]);
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404, headers });
  let base: URL;
  try { base = new URL(process.env.EMAILGO_PUBLIC_URL || new URL(request.url).origin); }
  catch { return NextResponse.json({ error: 'Set EMAILGO_PUBLIC_URL to a valid public origin.' }, { status: 503, headers }); }
  if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') return NextResponse.json({ error: 'EMAILGO_PUBLIC_URL must use HTTPS in production.' }, { status: 503, headers });
  try {
    const token = createContactPreferenceToken({ contactId: contact.id, email: contact.email });
    return NextResponse.json({ url: `${base.origin}/preferences/${token}` }, { headers });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Contact preference links are not configured.';
    return NextResponse.json({ error: message }, { status: 503, headers });
  }
}
