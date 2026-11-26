import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { queryOne } from '@/lib/database';

type WebhookAccess = { id: string; disabled_at: string | null };

export async function authorizeWebhookResource(request: Request, webhookId: string) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return { response: NextResponse.json({ error: { message: 'Invalid or revoked API key.' } }, { status: 401 }) };
  if (!hasFullApiAccess(apiKey)) return { response: NextResponse.json({ error: { message: 'This API key has sending-only access.' } }, { status: 403 }) };
  const webhook = await queryOne<WebhookAccess>('SELECT id,disabled_at FROM webhooks WHERE id=? AND api_key_id=?', [webhookId, apiKey.id]);
  if (!webhook) return { response: NextResponse.json({ error: { message: 'Webhook not found.' } }, { status: 404 }) };
  return { apiKey, webhook };
}
