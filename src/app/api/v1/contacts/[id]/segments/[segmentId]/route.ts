import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { nowIso, queryOne, transaction } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string; segmentId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const { id, segmentId } = await context.params;
  const contact = await queryOne<{ id: string }>('SELECT id FROM contacts WHERE workspace_id=? AND (id=? OR lower(email)=lower(?)) LIMIT 1', [key.workspaceId, id, id]);
  if (!contact) return error('Contact not found.', 404);
  if (!await queryOne<{ id: string }>('SELECT id FROM segments WHERE id=?', [segmentId])) return error('Segment not found.', 404);
  const timestamp = nowIso();
  await transaction([
    { sql: 'DELETE FROM segment_contact_exclusions WHERE segment_id=? AND contact_id=?', params: [segmentId, contact.id] },
    { sql: 'INSERT INTO segment_contacts(segment_id,contact_id,created_at) VALUES(?,?,?) ON CONFLICT(segment_id,contact_id) DO NOTHING', params: [segmentId, contact.id, timestamp] },
  ]);
  return NextResponse.json({ id: segmentId }, { headers: { 'Cache-Control': 'private, no-store' } });
}

async function __emailgo_DELETE_handler(request: Request, context: { params: Promise<{ id: string; segmentId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return error('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return error('This API key has sending-only access.', 403);
  const { id, segmentId } = await context.params;
  const contact = await queryOne<{ id: string }>('SELECT id FROM contacts WHERE workspace_id=? AND (id=? OR lower(email)=lower(?)) LIMIT 1', [key.workspaceId, id, id]);
  if (!contact) return error('Contact not found.', 404);
  if (!await queryOne<{ id: string }>('SELECT id FROM segments WHERE id=?', [segmentId])) return error('Segment not found.', 404);
  const timestamp = nowIso();
  await transaction([
    { sql: 'DELETE FROM segment_contacts WHERE segment_id=? AND contact_id=?', params: [segmentId, contact.id] },
    { sql: 'INSERT INTO segment_contact_exclusions(segment_id,contact_id,created_at) VALUES(?,?,?) ON CONFLICT(segment_id,contact_id) DO UPDATE SET created_at=excluded.created_at', params: [segmentId, contact.id, timestamp] },
  ]);
  return NextResponse.json({ object: 'contact_segment', id: contact.id, audienceId: segmentId, deleted: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
