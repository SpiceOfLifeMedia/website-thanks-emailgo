import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
type Row = { id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null; subject: string; message_id: string | null; headers_json: string | null; text_body: string | null; html_body: string | null; received_at: string };

export async function GET(_request: Request, context: Context) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: privateHeaders });
  const { id } = await context.params;
  const row = await queryOne<Row>('SELECT id,from_address,to_json,cc_json,bcc_json,subject,message_id,headers_json,text_body,html_body,received_at FROM received_emails WHERE id=?', [id]);
  if (!row) return NextResponse.json({ error: 'Received email not found.' }, { status: 404, headers: privateHeaders });
  const attachments = await query<{ id: string; filename: string; content_type: string; content_disposition: string | null; content_id: string | null; byte_length: number }>('SELECT id,filename,content_type,content_disposition,content_id,byte_length FROM received_email_attachments WHERE received_email_id=? ORDER BY created_at,id', [id]);
  return NextResponse.json({
    id: row.id,
    object: 'received_email',
    from: row.from_address,
    to: jsonValue(row.to_json, [] as string[]),
    ...(row.cc_json ? { cc: jsonValue(row.cc_json, [] as string[]) } : {}),
    ...(row.bcc_json ? { bcc: jsonValue(row.bcc_json, [] as string[]) } : {}),
    subject: row.subject,
    ...(row.message_id ? { message_id: row.message_id } : {}),
    ...(row.headers_json ? { headers: jsonValue(row.headers_json, {} as Record<string, string>) } : {}),
    ...(row.text_body !== null ? { text: row.text_body } : {}),
    ...(row.html_body !== null ? { html: row.html_body } : {}),
    attachments: attachments.rows.map((attachment) => ({ ...attachment, download_url: `/api/receiving/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}` })),
    received_at: row.received_at,
  }, { headers: privateHeaders });
}

function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
