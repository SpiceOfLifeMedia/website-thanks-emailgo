import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { queryOne } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; attachmentId: string }> };
type Attachment = { filename: string; content_type: string; content_base64: string; received_email_id: string };

export async function GET(_request: Request, context: Context) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  const { id, attachmentId } = await context.params;
  const row = await queryOne<Attachment>('SELECT a.filename,a.content_type,a.content_base64,a.received_email_id FROM received_email_attachments a JOIN received_emails e ON e.id=a.received_email_id WHERE e.id=? AND a.id=?', [id, attachmentId]);
  if (!row) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  const bytes = Buffer.from(row.content_base64, 'base64');
  const safeFilename = row.filename.replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'attachment';
  return new Response(bytes, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': row.content_type, 'Content-Length': String(bytes.byteLength), 'Content-Disposition': `attachment; filename="${safeFilename}"` } });
}
