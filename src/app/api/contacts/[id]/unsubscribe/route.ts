import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const contact = await queryOne<{ id: string; unsubscribed_at: string | null }>('SELECT id,unsubscribed_at FROM contacts WHERE id=?', [id]);
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  const timestamp = nowIso();
  await execute('UPDATE contacts SET unsubscribed_at=?,updated_at=? WHERE id=?', [contact.unsubscribed_at ?? timestamp, timestamp, id]);
  return NextResponse.json({ id, unsubscribed: true, unsubscribed_at: contact.unsubscribed_at ?? timestamp });
}
