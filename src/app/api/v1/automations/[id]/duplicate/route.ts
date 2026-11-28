import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne, randomId } from '@/lib/database';

export const runtime = 'nodejs';
async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  const { id } = await context.params;
  const source = await queryOne<{ name: string; trigger_event: string; steps_json: string; connections_json: string }>(
    "SELECT name,trigger_event,steps_json,connections_json FROM automations WHERE id=? AND api_key_id=? AND status<>'archived'", [id, key.id],
  );
  if (!source) return NextResponse.json({ error: { message: 'Automation not found.' } }, { status: 404 });
  const copyId = randomId('aut');
  const timestamp = nowIso();
  const name = `${source.name.slice(0, 93)} (Copy)`;
  await execute("INSERT INTO automations(id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?)",
    [copyId, key.id, name, source.trigger_event, source.steps_json, source.connections_json, timestamp, timestamp]);
  return NextResponse.json({ object: 'automation', id: copyId }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
