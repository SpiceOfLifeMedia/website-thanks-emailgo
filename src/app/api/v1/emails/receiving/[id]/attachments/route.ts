import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const email = await queryOne<{ id: string }>('SELECT id FROM received_emails WHERE id=? AND api_key_id=?', [id, key.id]);
  if (!email) return NextResponse.json({ error: { message: 'Received email not found.' } }, { status: 404, headers: privateHeaders });
  const result = await query<{ id: string; filename: string; content_type: string; content_disposition: string | null; content_id: string | null; byte_length: number }>('SELECT id,filename,content_type,content_disposition,content_id,byte_length FROM received_email_attachments WHERE received_email_id=? ORDER BY created_at,id', [id]);
  return NextResponse.json({ object: 'list', data: result.rows.map((attachment) => ({ id: attachment.id, filename: attachment.filename, content_type: attachment.content_type, content_disposition: attachment.content_disposition, content_id: attachment.content_id, size: attachment.byte_length, download_url: `/api/v1/emails/receiving/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}` })) }, { headers: privateHeaders });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
