import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { execute, queryOne } from '@/lib/database';
import { readJsonLimited } from '@/lib/request-json';
import { domainWebhookData } from '@/lib/domain-webhook';
import { emitWebhookEventToAllSubscribers } from '@/lib/webhooks';

export const runtime = 'nodejs';

type Domain = { id: string; domain: string; created_at: string; verified_at: string | null; open_tracking: number; click_tracking: number };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await context.params;
  const domain = await queryOne<Domain>('SELECT id,domain,created_at,verified_at,open_tracking,click_tracking FROM domains WHERE id=?', [id]);
  if (!domain) return NextResponse.json({ error: 'Sender domain not found.' }, { status: 404 });
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const body = parsed.value as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some((key) => !['open_tracking', 'click_tracking'].includes(key))) return NextResponse.json({ error: 'Only open_tracking and click_tracking can be updated.' }, { status: 400 });
  if (Object.values(body).some((value) => typeof value !== 'boolean')) return NextResponse.json({ error: 'Tracking settings must be booleans.' }, { status: 400 });
  const openTracking = body.open_tracking === undefined ? Boolean(domain.open_tracking) : Boolean(body.open_tracking);
  const clickTracking = body.click_tracking === undefined ? Boolean(domain.click_tracking) : Boolean(body.click_tracking);
  if ((openTracking || clickTracking) && !domain.verified_at) return NextResponse.json({ error: 'Verify this sender domain before enabling tracking.' }, { status: 409 });
  if ((openTracking || clickTracking) && (!process.env.EMAILGO_PUBLIC_URL || !process.env.EMAILGO_TRACKING_SECRET)) return NextResponse.json({ error: 'Tracking requires EMAILGO_PUBLIC_URL and EMAILGO_TRACKING_SECRET on this deployment.' }, { status: 503 });
  await execute('UPDATE domains SET open_tracking=?,click_tracking=? WHERE id=?', [openTracking ? 1 : 0, clickTracking ? 1 : 0, id]);
  const updatedAt = new Date().toISOString();
  await emitWebhookEventToAllSubscribers('domain.updated', domainWebhookData({
    ...domain, open_tracking: openTracking, click_tracking: clickTracking,
  }), `domain.updated:${id}:${updatedAt}`);
  return NextResponse.json({ id, domain: domain.domain, open_tracking: openTracking, click_tracking: clickTracking });
}
