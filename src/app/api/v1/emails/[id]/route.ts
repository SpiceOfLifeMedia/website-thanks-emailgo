import { NextResponse } from 'next/server';
import { authorizeApiKey } from '@/lib/auth';
import { getDatabase } from '@/lib/database';
export const runtime = 'nodejs';

type StoredEmail = { id: string; from_address: string; to_json: string; subject: string; status: string; error_message: string | null; provider_id: string | null; message_id: string | null; created_at: string };
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  const { id } = await context.params;
  const row = getDatabase().prepare(`SELECT id,from_address,to_json,subject,status,error_message,provider_id,message_id,created_at
    FROM emails WHERE id = ?`).get(id) as StoredEmail | undefined;
  if (!row) return NextResponse.json({ error: { message: 'Email not found.' } }, { status: 404 });
  return NextResponse.json({ id: row.id, object: 'email', from: row.from_address, to: JSON.parse(row.to_json) as string[], subject: row.subject, status: row.status, created_at: row.created_at, ...(row.message_id ? { messageId: row.message_id } : {}), ...(row.provider_id ? { relayResponse: row.provider_id } : {}), ...(row.status === 'failed' ? { error: 'Email delivery failed. Check the message details in your Emailgo dashboard.' } : {}) });
}
