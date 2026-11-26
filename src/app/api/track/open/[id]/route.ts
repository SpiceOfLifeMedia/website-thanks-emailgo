import { NextResponse } from 'next/server';
import { execute, nowIso, queryOne, randomId } from '@/lib/database';
import { verifyTrackingSignature } from '@/lib/tracking';
import { emitWebhookEvent } from '@/lib/webhooks';

export const runtime = 'nodejs';

const transparentGif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const signature = new URL(request.url).searchParams.get('s') ?? '';
  const secret = process.env.EMAILGO_TRACKING_SECRET;
  if (secret && signature && verifyTrackingSignature(secret, `open:${id}`, signature)) {
    try {
      const email = await queryOne<{ track_opens: number; api_key_id: string }>('SELECT track_opens,api_key_id FROM emails WHERE id=?', [id]);
      if (email?.track_opens) {
        await execute('INSERT INTO email_events(id,email_id,type,created_at) VALUES(?,?,?,?)', [randomId('evt'), id, 'email.opened', nowIso()]);
        await emitWebhookEvent(email.api_key_id, 'email.opened', { email_id: id });
      }
    } catch {}
  }
  return new NextResponse(transparentGif, {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache' },
  });
}
