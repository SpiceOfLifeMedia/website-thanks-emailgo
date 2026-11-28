import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { getWebhookSecret, webhookMasterSecret } from '@/lib/webhooks';

export const runtime = 'nodejs';
async function __emailgo_POST_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 });
  if (!hasFullApiAccess(apiKey)) return NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 });
  if (!webhookMasterSecret()) return NextResponse.json({ error: { message: 'Webhook signing is not configured.' } }, { status: 503 });
  const { id } = await context.params;
  const row = await queryOne<{ id: string; secret_generation: number }>('SELECT id,secret_generation FROM webhooks WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [id, apiKey.id]);
  if (!row) return NextResponse.json({ error: { message: 'Webhook not found.' } }, { status: 404 });
  const generation = row.secret_generation + 1;
  await execute('UPDATE webhooks SET secret_generation=?,updated_at=? WHERE id=? AND api_key_id=? AND disabled_at IS NULL', [generation, nowIso(), id, apiKey.id]);
  return NextResponse.json({ id, secret: getWebhookSecret(id, generation), message: 'Save this signing secret now. It is shown only once.' });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
