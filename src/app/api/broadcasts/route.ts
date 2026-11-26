import { NextResponse } from 'next/server';
import { authorizeBroadcastRequest, parseBroadcastInput, parseBroadcastDesign, validateBroadcastInput } from '@/lib/broadcasts';
import { execute, nowIso, query } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { randomId } from '@/lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const result = await query(`SELECT b.id,b.name,b.api_key_id,b.from_address,b.subject,b.text_body,b.html_body,b.editor_json,b.audience_type,b.audience_id,b.status,b.scheduled_at,b.recipient_count,b.created_at,b.updated_at,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='sent') AS INTEGER) AS sent_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='failed') AS INTEGER) AS failed_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='suppressed') AS INTEGER) AS suppressed_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status IN ('scheduled','processing')) AS INTEGER) AS pending_count
    FROM broadcasts b ORDER BY b.updated_at DESC,b.id DESC`);
  const data = result.rows.map((row) => {
    const { editor_json, ...broadcast } = row as Record<string, unknown> & { editor_json?: string | null };
    return { ...broadcast, design: parseBroadcastDesign(editor_json) };
  });
  return NextResponse.json({ data }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 1_050_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const input = parseBroadcastInput(parsed.value);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const validated = await validateBroadcastInput(input.value);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: validated.status });
  const timestamp = nowIso();
  const id = randomId('bc');
  await execute(`INSERT INTO broadcasts(id,name,api_key_id,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?)`, [id, input.value.name, input.value.apiKeyId, input.value.from, input.value.subject, input.value.text, input.value.html, input.value.design ? JSON.stringify(input.value.design) : null, input.value.audienceType, input.value.audienceId, timestamp, timestamp]);
  return NextResponse.json({ id, name: input.value.name, status: 'draft', recipient_count: 0, created_at: timestamp, updated_at: timestamp }, { status: 201, headers: privateHeaders });
}
