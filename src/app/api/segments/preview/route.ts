import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { countSegment, parseSegmentFilters } from '@/lib/segments';
import { readJsonLimited } from '@/lib/request-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return error('Request origin is not allowed.', 403);
  if (!await isAdminSession()) return error('Sign in required.', 401);
  const parsed = await readJsonLimited(request, 20_000);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return error('Request body must be a JSON object.', 400);
  const filters = parseSegmentFilters((parsed.value as Record<string, unknown>).filters);
  if (!filters.ok) return error(filters.error, 400);
  return NextResponse.json({ contacts_count: await countSegment(filters.filters) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
