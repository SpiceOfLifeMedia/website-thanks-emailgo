import { NextResponse } from 'next/server';
import { authorizeBroadcastRequest, parseBroadcastInput, parseBroadcastDesign, validateBroadcastInput } from '@/lib/broadcasts';
import { execute, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const { id } = await context.params;
  const broadcast = await queryOne(`SELECT b.id,b.name,b.api_key_id,b.from_address,b.subject,b.reply_to,b.preview_text,b.text_body,b.html_body,b.editor_json,b.audience_type,b.audience_id,b.status,b.folder_id,b.scheduled_at,b.recipient_count,b.created_at,b.updated_at,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='sent') AS INTEGER) AS sent_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='failed') AS INTEGER) AS failed_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status='suppressed') AS INTEGER) AS suppressed_count,
    CAST((SELECT COUNT(*) FROM emails e WHERE e.broadcast_id=b.id AND e.status IN ('scheduled','processing')) AS INTEGER) AS pending_count
    FROM broadcasts b WHERE b.id=?`, [id]);
  if (!broadcast) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: privateHeaders });
  const { editor_json, ...data } = broadcast as Record<string, unknown> & { editor_json?: string | null };
  return NextResponse.json({ ...data, design: parseBroadcastDesign(editor_json) }, { headers: privateHeaders });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const { id } = await context.params;
  const current = await queryOne<{ id: string; status: string }>('SELECT id,status FROM broadcasts WHERE id=?', [id]);
  if (!current) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: privateHeaders });
  if (current.status !== 'draft') return NextResponse.json({ error: 'Only draft broadcasts can be edited.' }, { status: 409, headers: privateHeaders });
  const parsed = await readJsonLimited(request, 1_050_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: privateHeaders });
  const input = parseBroadcastInput(parsed.value);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400, headers: privateHeaders });
  const validated = await validateBroadcastInput(input.value);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: validated.status, headers: privateHeaders });
  const updated = await execute(`UPDATE broadcasts SET name=?,api_key_id=?,from_address=?,subject=?,reply_to=?,preview_text=?,text_body=?,html_body=?,editor_json=?,audience_type=?,audience_id=?,updated_at=? WHERE id=? AND status='draft'`, [input.value.name, input.value.apiKeyId, input.value.from, input.value.subject, input.value.replyTo, input.value.previewText, input.value.text, input.value.html, input.value.design ? JSON.stringify(input.value.design) : null, input.value.audienceType, input.value.audienceId, new Date().toISOString(), id]);
  return updated ? NextResponse.json({ id, status: 'draft', updated: true }, { headers: privateHeaders }) : NextResponse.json({ error: 'This broadcast changed while it was being edited.' }, { status: 409, headers: privateHeaders });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeBroadcastRequest(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: privateHeaders });
  const { id } = await context.params;
  const deleted = await execute("DELETE FROM broadcasts WHERE id=? AND status='draft'", [id]);
  if (deleted) return NextResponse.json({ id, deleted: true }, { headers: privateHeaders });
  const current = await queryOne<{ status: string }>('SELECT status FROM broadcasts WHERE id=?', [id]);
  return current ? NextResponse.json({ error: 'Only draft broadcasts can be deleted.' }, { status: 409, headers: privateHeaders }) : NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: privateHeaders });
}
