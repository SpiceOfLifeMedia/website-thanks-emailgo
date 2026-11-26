import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { addSuppression, isValidSuppressionAddress, removeSuppression, suppressionResponse } from '@/lib/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
function error(message: string, status: number) { return NextResponse.json({ error: { message } }, { status, headers: privateHeaders }); }

async function readEmails(request: Request) {
  const parsed = await readJsonLimited(request, 25_000);
  if (!parsed.ok) return { error: error(parsed.error, parsed.status) } as const;
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return { error: error('Request body must be a JSON object.', 400) } as const;
  const emails = (parsed.value as Record<string, unknown>).emails;
  if (!Array.isArray(emails) || emails.length < 1 || emails.length > 100 || !emails.every(isValidSuppressionAddress)) return { error: error('emails must contain between 1 and 100 valid email addresses.', 400) } as const;
  const normalized = emails.map((email) => email.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) return { error: error('emails cannot contain duplicates.', 400) } as const;
  return { emails: normalized } as const;
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const input = await readEmails(request);
  if ('error' in input) return input.error;
  const rows = await Promise.all(input.emails.map((email) => addSuppression(email)));
  return NextResponse.json({ object: 'list', data: rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(suppressionResponse) }, { status: 201, headers: privateHeaders });
}

export async function DELETE(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const input = await readEmails(request);
  if ('error' in input) return input.error;
  const rows = await Promise.all(input.emails.map((email) => removeSuppression(email)));
  return NextResponse.json({ object: 'list', data: rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map(suppressionResponse) }, { headers: privateHeaders });
}
