import { createHmac, timingSafeEqual } from 'node:crypto';

export type EmailTracking = { openTracking: boolean; clickTracking: boolean };

function configuration() {
  const rawUrl = process.env.EMAILGO_PUBLIC_URL;
  const secret = process.env.EMAILGO_TRACKING_SECRET;
  if (!rawUrl || !secret) throw new Error('Open and click tracking require EMAILGO_PUBLIC_URL and EMAILGO_TRACKING_SECRET.');
  const base = new URL(rawUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('EMAILGO_PUBLIC_URL must be a public HTTP(S) origin without a path, query or credentials.');
  return { base: base.origin, secret };
}

function sign(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeTarget(value: string) {
  try {
    const url = new URL(value.replaceAll('&amp;', '&'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function trackedHtml(emailId: string, html: string, tracking: EmailTracking) {
  if (!tracking.openTracking && !tracking.clickTracking) return html;
  const { base, secret } = configuration();
  let tracked = html;
  if (tracking.clickTracking) {
    tracked = tracked.replace(/(\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (match, prefix: string, quote: string, rawUrl: string) => {
      const target = safeTarget(rawUrl);
      if (!target) return match;
      const signature = sign(secret, `click:${emailId}\0${target}`);
      const redirect = new URL('/api/track/click', base);
      redirect.searchParams.set('i', emailId);
      redirect.searchParams.set('u', target);
      redirect.searchParams.set('s', signature);
      return `${prefix}${quote}${redirect.toString()}${quote}`;
    });
  }
  if (tracking.openTracking) {
    const signature = sign(secret, `open:${emailId}`);
    const image = `<img src="${base}/api/track/open/${encodeURIComponent(emailId)}?s=${encodeURIComponent(signature)}" width="1" height="1" alt="" style="display:none!important;width:1px;height:1px;border:0" />`;
    tracked = /<\/body\s*>/i.test(tracked) ? tracked.replace(/<\/body\s*>/i, `${image}</body>`) : `${tracked}${image}`;
  }
  return tracked;
}

export function verifyTrackingSignature(secret: string, value: string, signature: string) {
  const expected = Buffer.from(sign(secret, value));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function parseTrackingTarget(value: string) {
  const target = safeTarget(value);
  if (!target) return null;
  const url = new URL(target);
  return { url: target, domain: url.hostname.toLowerCase(), path: url.pathname.slice(0, 1000) };
}
