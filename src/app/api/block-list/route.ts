import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { readJsonLimited } from '@/lib/request-json';
import { addSuppression, getSuppression, isValidSuppressionAddress, listSuppressions } from '@/lib/suppressions';

export const runtime = 'nodejs';

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const rows = await listSuppressions(2_000);
  return NextResponse.json({ data: rows.map((row) => ({
    address: row.email,
    reason: row.origin === 'bounce' ? 'bounced' : row.origin === 'complaint' ? 'complained' : 'manual',
    added_at: row.created_at,
    removable: row.origin === 'manual',
  })) });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const parsed = await readJsonLimited(request, 10_000);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const value = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    ? (parsed.value as Record<string, unknown>).address : undefined;
  if (!isValidSuppressionAddress(value)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (await getSuppression(value)) return NextResponse.json({ error: 'That address is already on the block list.' }, { status: 409 });
  const row = await addSuppression(value, 'manual');
  if (!row) return NextResponse.json({ error: 'The address could not be added.' }, { status: 500 });
  return NextResponse.json({ address: row.email, reason: 'manual', added_at: row.created_at, removable: true }, { status: 201 });
}
