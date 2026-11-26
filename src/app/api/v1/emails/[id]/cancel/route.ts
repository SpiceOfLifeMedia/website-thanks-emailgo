import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const updated = await execute('UPDATE emails SET status=?,processing_started_at=NULL,next_attempt_at=NULL,attachment_payload_json=NULL WHERE id=? AND api_key_id=? AND status=?', ['canceled', id, apiKey.id, 'scheduled']);
  if (updated) return NextResponse.json({ object: 'email', id, status: 'canceled', canceled: true });
  const existing = await queryOne<{ id: string; status: string }>('SELECT id,status FROM emails WHERE id=? AND api_key_id=?', [id, apiKey.id]);
  if (!existing) return NextResponse.json({ error: { message: 'Email not found.' } }, { status: 404 });
  return NextResponse.json({ error: { message: 'Only scheduled emails can be canceled.' } }, { status: 409 });
}
