import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne, randomId } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const source = await queryOne<{ name: string; api_key_id: string; from_address: string; subject: string; text_body: string | null; html_body: string | null; editor_json: string | null; audience_type: string; audience_id: string }>(
    'SELECT name,api_key_id,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id FROM broadcasts WHERE id=? AND api_key_id=?', [id, key.id],
  );
  if (!source) return errorResponse('Broadcast not found.', 404);
  const name = `${source.name.slice(0, 64)} (copy)`;
  const duplicateId = randomId('bc');
  const timestamp = nowIso();
  await execute(`INSERT INTO broadcasts(id,name,api_key_id,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?)`, [duplicateId, name, source.api_key_id, source.from_address, source.subject, source.text_body, source.html_body, source.editor_json, source.audience_type, source.audience_id, timestamp, timestamp]);
  return NextResponse.json({ object: 'broadcast', id: duplicateId }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
