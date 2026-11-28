import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401, headers: privateHeaders });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403, headers: privateHeaders });
  const { id, attachmentId } = await context.params;
  const attachment = await queryOne<{ filename: string; content_type: string; content_base64: string }>(`SELECT a.filename,a.content_type,a.content_base64 FROM received_email_attachments a
    JOIN received_emails e ON e.id=a.received_email_id WHERE a.id=? AND e.id=? AND e.api_key_id=?`, [attachmentId, id, key.id]);
  if (!attachment) return NextResponse.json({ error: { message: 'Received email attachment not found.' } }, { status: 404, headers: privateHeaders });
  const bytes = Buffer.from(attachment.content_base64, 'base64');
  const safeFilename = attachment.filename.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim() || 'attachment';
  return new Response(bytes, { headers: { ...privateHeaders, 'Content-Type': attachment.content_type, 'Content-Length': String(bytes.byteLength), 'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}` } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
