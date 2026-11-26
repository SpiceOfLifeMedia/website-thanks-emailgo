import { createVerify } from 'node:crypto';

export type SnsEnvelope = {
  Type: string; MessageId: string; TopicArn: string; Message: string; Timestamp: string;
  SignatureVersion: string; Signature: string; SigningCertURL: string;
  Subject?: string; Token?: string; SubscribeURL?: string;
};

export type DeliveryEventType = 'delivered' | 'bounced' | 'complained' | 'deferred';
export type DeliveryEvent = { type: DeliveryEventType; relayMessageId: string; recipient: string; suppress: boolean; detail: string };

const snsHost = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certificateCache = new Map<string, string>();

export function trustedSnsUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && snsHost.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function parseSnsEnvelope(value: unknown): SnsEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const required = ['Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'];
  if (!required.every((key) => typeof body[key] === 'string' && body[key])) return null;
  for (const key of ['Subject', 'Token', 'SubscribeURL']) if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') return null;
  return body as unknown as SnsEnvelope;
}

export function snsStringToSign(envelope: SnsEnvelope) {
  const keys = envelope.Type === 'Notification'
    ? ['Message', 'MessageId', ...(envelope.Subject ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys.map((key) => `${key}\n${envelope[key as keyof SnsEnvelope] ?? ''}\n`).join('');
}

async function downloadCertificate(url: URL) {
  const cached = certificateCache.get(url.href);
  if (cached) return cached;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('Could not download the SNS signing certificate.');
  const pem = await response.text();
  if (!pem.includes('BEGIN CERTIFICATE')) throw new Error('The SNS signing certificate is invalid.');
  certificateCache.set(url.href, pem);
  return pem;
}

export async function verifySnsSignature(envelope: SnsEnvelope, fetchCertificate: (url: URL) => Promise<string> = downloadCertificate) {
  const certificateUrl = trustedSnsUrl(envelope.SigningCertURL);
  if (!certificateUrl || !certificateUrl.pathname.endsWith('.pem')) return false;
  const algorithm = envelope.SignatureVersion === '1' ? 'RSA-SHA1' : envelope.SignatureVersion === '2' ? 'RSA-SHA256' : null;
  if (!algorithm) return false;
  try {
    const certificate = await fetchCertificate(certificateUrl);
    return createVerify(algorithm).update(snsStringToSign(envelope), 'utf8').verify(certificate, envelope.Signature, 'base64');
  } catch {
    return false;
  }
}

export function relayMessageIdFromResponse(response: string) {
  return /^250\s+Ok\s+(\S+)/i.exec(response.trim())?.[1] ?? null;
}

function addresses(list: unknown, field = 'emailAddress') {
  if (!Array.isArray(list)) return [];
  return list.map((item) => typeof item === 'string' ? item : (item as Record<string, unknown>)?.[field]).filter((item): item is string => typeof item === 'string' && item.length <= 254).map((item) => item.trim().toLowerCase());
}

export function parseSesNotification(message: string): DeliveryEvent[] {
  let body: Record<string, unknown>;
  try { body = JSON.parse(message) as Record<string, unknown>; } catch { return []; }
  const kind = typeof body.notificationType === 'string' ? body.notificationType : body.eventType;
  const mail = body.mail as Record<string, unknown> | undefined;
  const relayMessageId = typeof mail?.messageId === 'string' ? mail.messageId : '';
  if (!relayMessageId) return [];
  if (kind === 'Bounce') {
    const bounce = body.bounce as Record<string, unknown> | undefined;
    const bounceType = String(bounce?.bounceType ?? 'Undetermined');
    const permanent = bounceType === 'Permanent';
    const detail = `${bounceType}${bounce?.bounceSubType ? ` / ${String(bounce.bounceSubType)}` : ''}`.slice(0, 200);
    return addresses(bounce?.bouncedRecipients).map((recipient) => ({ type: permanent ? 'bounced' : 'deferred', relayMessageId, recipient, suppress: permanent, detail }));
  }
  if (kind === 'Complaint') {
    const complaint = body.complaint as Record<string, unknown> | undefined;
    const detail = String(complaint?.complaintFeedbackType ?? 'complaint').slice(0, 200);
    return addresses(complaint?.complainedRecipients).map((recipient) => ({ type: 'complained', relayMessageId, recipient, suppress: true, detail }));
  }
  if (kind === 'Delivery') {
    const delivery = body.delivery as Record<string, unknown> | undefined;
    return addresses(delivery?.recipients, '').map((recipient) => ({ type: 'delivered', relayMessageId, recipient, suppress: false, detail: 'Delivered' }));
  }
  return [];
}

const statusRank: Record<string, number> = { queued: 0, failed: 0, sent: 1, deferred: 2, delivered: 3, bounced: 4, complained: 5 };
export function strongerStatus(current: string, next: DeliveryEventType) {
  return (statusRank[next] ?? 0) > (statusRank[current] ?? 0) ? next : current;
}
