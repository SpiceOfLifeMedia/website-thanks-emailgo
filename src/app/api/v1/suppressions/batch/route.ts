import { withApiRequestLog } from '@/lib/request-logs';
import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { addSuppression, isValidSuppressionAddress, removeSuppression, suppressionResponse } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

async function authorize(request: Request): Promise<{ error: Response } | { key: NonNullable<Awaited<ReturnType<typeof authorizeApiKey>>> }> {
  const key = await authorizeApiKey(request);
  if (!key) return { error: error('Invalid or revoked API key.', 401) };
  if (!hasFullApiAccess(key)) return { error: error('This API key has sending-only access.', 403) };
  return { key };
}

async function readEmails(request: Request): Promise<{ error: Response } | { emails: string[] }> {
  const parsed = await readJsonLimited(request, 25_000);
  if (!parsed.ok) return { error: error(parsed.error, parsed.status) } as const;
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return { error: error('Request body must be a JSON object.', 400) } as const;
  const emails = (parsed.value as Record<string, unknown>).emails;
  if (!Array.isArray(emails) || emails.length < 1 || emails.length > 100 || !emails.every(isValidSuppressionAddress)) return { error: error('emails must contain between 1 and 100 valid email addresses.', 400) } as const;
  const normalized = emails.map((email) => email.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) return { error: error('emails cannot contain duplicates.', 400) } as const;
  return { emails: normalized } as const;
}

async function __emailgo_POST_handler(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const input = await readEmails(request);
  if ('error' in input) return input.error;
  const rows = await Promise.all(input.emails.map((email) => addSuppression(email)));
  if (rows.some((row) => !row)) return error('One or more suppressions could not be saved.', 500);
  return NextResponse.json({ object: 'list', data: rows.map((row) => ({ id: row!.id, email: row!.email })) }, { status: 201, headers: privateHeaders });
}

async function __emailgo_DELETE_handler(request: Request): Promise<Response> {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const input = await readEmails(request);
  if ('error' in input) return input.error;
  const rows = await Promise.all(input.emails.map((email) => removeSuppression(email)));
  return NextResponse.json({ object: 'list', data: rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(suppressionResponse) }, { headers: privateHeaders });
}

export const POST = withApiRequestLog(__emailgo_POST_handler);
export const DELETE = withApiRequestLog(__emailgo_DELETE_handler);
