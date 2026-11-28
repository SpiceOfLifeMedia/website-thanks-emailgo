import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, nowIso, queryOne } from '@/lib/database';
import { getWebhookSecret, webhookMasterSecret } from '@/lib/webhooks';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (!webhookMasterSecret()) return NextResponse.json({ error: 'Webhook signing is not configured.' }, { status: 503 });
  const { id } = await context.params;
  const row = await queryOne<{ id: string; secret_generation: number }>('SELECT id,secret_generation FROM webhooks WHERE id=? AND disabled_at IS NULL', [id]);
  if (!row) return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 });
  const generation = row.secret_generation + 1;
  await execute('UPDATE webhooks SET secret_generation=?,updated_at=? WHERE id=? AND disabled_at IS NULL', [generation, nowIso(), id]);
  return NextResponse.json({ id, secret: getWebhookSecret(id, generation), message: 'Save this signing secret now. It is shown only once.' });
}
