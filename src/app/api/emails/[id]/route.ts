import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EmailDetail = {
  id: string;
  from_address: string;
  to_json: string;
  cc_json: string | null;
  bcc_json: string | null;
  reply_to: string | null;
  headers_json: string | null;
  tags_json: string | null;
  attachments_json: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  status: string;
  error_message: string | null;
  provider_id: string | null;
  message_id: string | null;
  scheduled_at: string | null;
  created_at: string;
};

function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  const { id } = await context.params;
  const row = await queryOne<EmailDetail>(`SELECT id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,subject,text_body,html_body,status,error_message,provider_id,message_id,scheduled_at,created_at
    FROM emails WHERE id=?`, [id]);
  if (!row) return NextResponse.json({ error: 'Email not found.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  return NextResponse.json({
    id: row.id,
    from: row.from_address,
    to: jsonValue<string[]>(row.to_json, []),
    cc: jsonValue<string[]>(row.cc_json, []),
    bcc: jsonValue<string[]>(row.bcc_json, []),
    reply_to: row.reply_to,
    headers: jsonValue<Record<string, string>>(row.headers_json, {}),
    tags: jsonValue<Array<{ name: string; value: string }>>(row.tags_json, []),
    attachments: jsonValue<Array<{ filename: string; contentType?: string; contentId?: string }>>(row.attachments_json, []),
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    status: row.status,
    error: row.error_message,
    relay_response: row.provider_id,
    message_id: row.message_id,
    scheduled_at: row.scheduled_at,
    created_at: row.created_at,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
