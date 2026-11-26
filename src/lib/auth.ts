import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { execute, hashSecret, nowIso, queryOne } from '@/lib/database';

const SESSION_COOKIE = 'emailgo_session';
const SESSION_HOURS = 8;
type AuthorizedRequestKey = { id: string; name: string; prefix: string };
const authorizedRequestKeys = new WeakMap<Request, AuthorizedRequestKey>();

export function getAuthorizedRequestKeyId(request: Request) {
  return authorizedRequestKeys.get(request)?.id ?? null;
}

export function getAuthorizedRequestKey(request: Request) {
  return authorizedRequestKeys.get(request) ?? null;
}

function adminPassword() { return process.env.EMAILGO_ADMIN_PASSWORD; }
function sessionSecret() { return process.env.EMAILGO_SESSION_SECRET || adminPassword(); }

export function hasAdminSetup() { return Boolean(adminPassword() && sessionSecret()); }

function sign(payload: string) {
  return createHmac('sha256', sessionSecret()!).update(payload).digest('base64url');
}

export async function isAdminSession() {
  if (!hasAdminSetup()) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp: number };
    return Number.isFinite(session.exp) && session.exp > Date.now();
  } catch { return false; }
}

export function verifyAdminPassword(candidate: string) {
  const expected = adminPassword();
  if (!expected) return false;
  const candidateHash = Buffer.from(hashSecret(candidate));
  const expectedHash = Buffer.from(hashSecret(expected));
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash);
}

export function createAdminSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export const adminCookie = SESSION_COOKIE;
export const sessionMaxAge = SESSION_HOURS * 60 * 60;

export function hasTrustedBrowserOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const requestHost = forwardedHost || request.headers.get('host');
  if (!origin) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite) return fetchSite === 'same-origin';
    const referer = request.headers.get('referer');
    if (!referer || !requestHost) return false;
    try {
      const refererUrl = new URL(referer);
      return (refererUrl.protocol === 'https:' || refererUrl.protocol === 'http:') && refererUrl.host.toLowerCase() === requestHost.toLowerCase();
    } catch { return false; }
  }
  try {
    const originUrl = new URL(origin);
    return (originUrl.protocol === 'https:' || originUrl.protocol === 'http:') && Boolean(requestHost) && originUrl.host.toLowerCase() === requestHost!.toLowerCase();
  } catch { return false; }
}

export async function authorizeApiKey(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ((?:eg|st)_live_[A-Za-z0-9_-]{40,})$/.exec(authorization);
  if (!match) return null;
  const secret = match[1];
  const prefix = secret.slice(0, 20);
  const row = await queryOne<{ id: string; name: string; prefix: string; secret_hash: string; permission: string; domain_id: string | null }>('SELECT id, name, prefix, secret_hash, permission, domain_id FROM api_keys WHERE prefix = ? AND revoked_at IS NULL', [prefix]);
  if (!row) return null;
  const supplied = Buffer.from(hashSecret(secret));
  const stored = Buffer.from(row.secret_hash);
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;
  await execute('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  authorizedRequestKeys.set(request, { id: row.id, name: row.name, prefix: row.prefix });
  return { id: row.id, permission: row.permission === 'sending_access' ? 'sending_access' as const : 'full_access' as const, domainId: row.domain_id };
}

export function hasFullApiAccess(apiKey: { permission: string }) {
  return apiKey.permission === 'full_access';
}
