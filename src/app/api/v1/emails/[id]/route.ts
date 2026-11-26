import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

type StoredEmail = { id: string; from_address: string; to_json: string; cc_json: string | null; bcc_json: string | null; reply_to: string | null; headers_json: string | null; tags_json: string | null; attachments_json: string | null; text_body: string | null; html_body: string | null; subject: string; status: string; error_message: string | null; provider_id: string | null; message_id: string | null; scheduled_at: string | null; created_at: string };
function jsonValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id } = await context.params;
  const row = await queryOne<StoredEmail>(`SELECT id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,text_body,html_body,subject,status,error_message,provider_id,message_id,scheduled_at,created_at
    FROM emails WHERE id = ? AND api_key_id = ?`, [id, apiKey.id]);
  if (!row) return NextResponse.json({ error: { message: 'Email not found.' } }, { status: 404, headers: privateHeaders });
  return NextResponse.json({
    id: row.id,
    object: 'email',
    from: row.from_address,
    to: jsonValue<string[]>(row.to_json, []),
    ...(row.cc_json ? { cc: jsonValue<string[]>(row.cc_json, []) } : {}),
    ...(row.bcc_json ? { bcc: jsonValue<string[]>(row.bcc_json, []) } : {}),
    ...(row.reply_to ? { reply_to: row.reply_to } : {}),
    ...(row.headers_json ? { headers: jsonValue<Record<string, string>>(row.headers_json, {}) } : {}),
    ...(row.tags_json ? { tags: jsonValue<Array<{ name: string; value: string }>>(row.tags_json, []) } : {}),
    ...(row.attachments_json ? { attachments: jsonValue<Array<{ filename: string; contentType?: string; contentId?: string }>>(row.attachments_json, []) } : {}),
    subject: row.subject,
    ...(row.text_body !== null ? { text: row.text_body } : {}),
    ...(row.html_body !== null ? { html: row.html_body } : {}),
    status: row.status,
    created_at: row.created_at,
    ...(row.message_id ? { messageId: row.message_id } : {}),
    ...(row.provider_id ? { relayResponse: row.provider_id } : {}),
    ...(row.scheduled_at ? { scheduled_at: row.scheduled_at } : {}),
    ...(row.status === 'failed' ? { error: 'Email delivery failed. Check the message details in your Emailgo dashboard.' } : {}),
  }, { headers: privateHeaders });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: { message: 'Scheduled sending is not configured on this Emailgo deployment.' } }, { status: 503 });
  const { id } = await context.params;
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: { message: parsed.error } }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: { message: 'Request body must be a JSON object.' } }, { status: 400 });
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.scheduled_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.scheduled_at) || !Number.isFinite(Date.parse(body.scheduled_at))) return NextResponse.json({ error: { message: 'Provide only a valid scheduled_at ISO 8601 timestamp.' } }, { status: 400 });
  const scheduleTime = Date.parse(body.scheduled_at);
  if (scheduleTime <= Date.now()) return NextResponse.json({ error: { message: 'scheduled_at must be in the future.' } }, { status: 400 });
  if (scheduleTime > Date.now() + 30 * 24 * 60 * 60 * 1000) return NextResponse.json({ error: { message: 'scheduled_at cannot be more than 30 days in the future.' } }, { status: 400 });
  const update = await execute('UPDATE emails SET scheduled_at=?,next_attempt_at=NULL WHERE id=? AND api_key_id=? AND status=?', [new Date(scheduleTime).toISOString(), id, apiKey.id, 'scheduled']);
  if (!update) {
    const existing = await queryOne<{ id: string; status: string }>('SELECT id,status FROM emails WHERE id=? AND api_key_id=?', [id, apiKey.id]);
    if (!existing) return NextResponse.json({ error: { message: 'Email not found.' } }, { status: 404 });
    return NextResponse.json({ error: { message: 'Only scheduled emails can be rescheduled.' } }, { status: 409 });
  }
  const row = await queryOne<StoredEmail>(`SELECT id,from_address,to_json,cc_json,bcc_json,reply_to,headers_json,tags_json,attachments_json,subject,status,error_message,provider_id,message_id,scheduled_at,created_at
    FROM emails WHERE id=? AND api_key_id=?`, [id, apiKey.id]);
  return row ? NextResponse.json({ id: row.id, object: 'email', status: row.status, scheduled_at: row.scheduled_at }) : NextResponse.json({ error: { message: 'Updated email could not be read.' } }, { status: 500 });
}
