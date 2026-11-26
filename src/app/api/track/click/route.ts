import { NextResponse } from 'next/server';
import { execute, nowIso, queryOne, randomId } from '@/lib/database';
import { parseTrackingTarget, verifyTrackingSignature } from '@/lib/tracking';
import { emitWebhookEvent } from '@/lib/webhooks';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const id = search.get('i') ?? '';
  const rawTarget = search.get('u') ?? '';
  const signature = search.get('s') ?? '';
  const target = parseTrackingTarget(rawTarget);
  const secret = process.env.EMAILGO_TRACKING_SECRET;
  if (!id || !target || !secret || !verifyTrackingSignature(secret, `click:${id}\0${target.url}`, signature)) {
    return NextResponse.json({ error: 'Invalid tracking link.' }, { status: 404 });
  }
  const email = await queryOne<{ track_clicks: number; api_key_id: string }>('SELECT track_clicks,api_key_id FROM emails WHERE id=?', [id]);
  if (!email?.track_clicks) return NextResponse.json({ error: 'Invalid tracking link.' }, { status: 404 });
  try {
    await execute('INSERT INTO email_events(id,email_id,type,created_at,target_domain,target_path) VALUES(?,?,?,?,?,?)', [
      randomId('evt'), id, 'email.clicked', nowIso(), target.domain, target.path,
    ]);
  } catch {}
  await emitWebhookEvent(email.api_key_id, 'email.clicked', { email_id: id, url_domain: target.domain, url_path: target.path });
  return NextResponse.redirect(target.url, 302);
}
