import { NextResponse } from 'next/server';
import { emailHtmlToPlainText } from '@/lib/email-share-policy';
import { readSharedEmail } from '@/lib/email-shares';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  const parsed = await readJsonLimited(request, 5_000);
  if (!parsed.ok) return NextResponse.json({ error: 'This link isn’t available.' }, { status: 400, headers: privateHeaders });
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: 'This link isn’t available.' }, { status: 400, headers: privateHeaders });
  }

  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'This link isn’t available.' }, { status: 400, headers: privateHeaders });
  }

  const shared = await readSharedEmail(body.token);
  if (!shared) return NextResponse.json({ error: 'This link isn’t available.' }, { status: 404, headers: privateHeaders });
  const text = shared.text ?? (shared.html ? emailHtmlToPlainText(shared.html) : null);
  return NextResponse.json({
    object: 'shared_email',
    from: shared.from,
    to: shared.to,
    subject: shared.subject,
    text,
    sent_at: shared.sentAt,
    expires_at: shared.expiresAt,
    has_attachments: shared.hasAttachments,
  }, { headers: privateHeaders });
}
