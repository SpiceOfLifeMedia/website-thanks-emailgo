import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { retryAutomationRun } from '@/lib/automations';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(key)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });

  let body: Record<string, unknown> = {};
  if (request.body) {
    const parsed = await readJsonLimited(request, 8_000);
    if (!parsed.ok) return NextResponse.json({ error: { message: parsed.error } }, { status: parsed.status });
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: { message: 'Request body must be an object.' } }, { status: 400 });
    body = parsed.value as Record<string, unknown>;
  }
  if (Object.keys(body).some((keyName) => keyName !== 'confirm_send_retry')) return NextResponse.json({ error: { message: 'Only confirm_send_retry is accepted.' } }, { status: 400 });
  if (body.confirm_send_retry !== undefined && typeof body.confirm_send_retry !== 'boolean') return NextResponse.json({ error: { message: 'confirm_send_retry must be a boolean.' } }, { status: 400 });

  const { id, runId } = await context.params;
  const retried = await retryAutomationRun(key.id, id, runId, body.confirm_send_retry === true);
  if (!retried.ok) return NextResponse.json({ error: { message: retried.error } }, { status: retried.status });
  return NextResponse.json({ object: 'automation_run', ...retried.run }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
