import { NextResponse } from 'next/server';
import { verifyContactPreferenceToken, unsubscribeContact } from '@/lib/contact-preferences';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) return NextResponse.json({ error: 'One-click unsubscribe requires an URL-encoded form.' }, { status: 415, headers });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Invalid unsubscribe form.' }, { status: 400, headers }); }
  if (form.get('List-Unsubscribe') !== 'One-Click') return NextResponse.json({ error: 'Invalid unsubscribe action.' }, { status: 400, headers });
  const { token } = await context.params;
  const identity = verifyContactPreferenceToken(token);
  if (!identity) return NextResponse.json({ error: 'This unsubscribe link is invalid.' }, { status: 404, headers });
  const contact = await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [identity.contactId]);
  if (!contact || contact.email !== identity.email) return NextResponse.json({ error: 'This unsubscribe link is invalid.' }, { status: 404, headers });
  await unsubscribeContact(contact.id);
  return new NextResponse(null, { status: 204, headers });
}
