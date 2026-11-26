import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
type ReceivedEmail = { id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null; subject: string; message_id: string | null; headers_json: string | null; text_body: string | null; html_body: string | null; received_at: string };

function json<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(request: Request, context: Context) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const email = await queryOne<ReceivedEmail>('SELECT id,from_address,to_json,cc_json,bcc_json,subject,message_id,headers_json,text_body,html_body,received_at FROM received_emails WHERE id=? AND api_key_id=?', [id, key.id]);
  if (!email) return NextResponse.json({ error: { message: 'Received email not found.' } }, { status: 404, headers: privateHeaders });
  const attachments = await query<{ id: string; filename: string; content_type: string; content_disposition: string | null; content_id: string | null; byte_length: number }>('SELECT id,filename,content_type,content_disposition,content_id,byte_length FROM received_email_attachments WHERE received_email_id=? ORDER BY created_at,id', [id]);
  return NextResponse.json({ id, object: 'received_email', from: email.from_address, to: json(email.to_json, []), ...(email.cc_json ? { cc: json(email.cc_json, []) } : {}), ...(email.bcc_json ? { bcc: json(email.bcc_json, []) } : {}), subject: email.subject, ...(email.message_id ? { message_id: email.message_id } : {}), ...(email.headers_json ? { headers: json(email.headers_json, {}) } : {}), ...(email.text_body !== null ? { text: email.text_body } : {}), ...(email.html_body !== null ? { html: email.html_body } : {}), attachments: attachments.rows.map((attachment) => ({ id: attachment.id, filename: attachment.filename, content_type: attachment.content_type, content_disposition: attachment.content_disposition, content_id: attachment.content_id, size: attachment.byte_length, download_url: `/api/v1/emails/receiving/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}` })), received_at: email.received_at }, { headers: privateHeaders });
}
