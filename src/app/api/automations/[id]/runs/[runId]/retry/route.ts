import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { retryAutomationRun } from '@/lib/automations';
import { queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);

  let body: Record<string, unknown> = {};
  if (request.body) {
    const parsed = await readJsonLimited(request, 8_000);
    if (!parsed.ok) return error(parsed.error, parsed.status);
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be an object.', 400);
    body = parsed.value as Record<string, unknown>;
  }
  if (Object.keys(body).some((keyName) => keyName !== 'confirm_send_retry')) return error('Only confirm_send_retry is accepted.', 400);
  if (body.confirm_send_retry !== undefined && typeof body.confirm_send_retry !== 'boolean') return error('confirm_send_retry must be a boolean.', 400);

  const { id, runId } = await context.params;
  const automation = await queryOne<{ api_key_id: string }>('SELECT api_key_id FROM automations WHERE id=?', [id]);
  if (!automation) return error('Automation not found.', 404);
  const retried = await retryAutomationRun(automation.api_key_id, id, runId, body.confirm_send_retry === true);
  return retried.ok ? NextResponse.json({ id: retried.run.id, status: retried.run.status, step_key: retried.run.step_key, attempt: retried.run.attempt }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } }) : error(retried.error, retried.status);
}
