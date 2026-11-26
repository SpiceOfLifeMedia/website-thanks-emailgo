import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { queryOne } from '@/lib/database';
import { withApiRequestLog } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportRow = { id: string; status: string; counts_json: string; errors_json: string; created_at: string; completed_at: string | null };
type ImportSummary = { id: string; object: 'contact_import'; status: string; created_at: string; completed_at: string | null; counts: Record<string, number>; errors?: Array<{ row: number; message: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function toSummary(row: ImportRow): ImportSummary {
  let counts: Record<string, number> = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  let errors: Array<{ row: number; message: string }> = [];
  try { counts = { ...counts, ...JSON.parse(row.counts_json) }; } catch {}
  try { errors = JSON.parse(row.errors_json) as Array<{ row: number; message: string }>; } catch {}
  return { id: row.id, object: 'contact_import', status: row.status, created_at: row.created_at, completed_at: row.completed_at, counts, ...(errors.length ? { errors } : {}) };
}

async function __emailgo_GET_handler(request: Request, context: { params: Promise<{ id: string }> }) {
  const key = await authorizeApiKey(request);
  if (!key) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(key)) return errorResponse('This API key has sending-only access.', 403);
  const { id } = await context.params;
  const row = await queryOne<ImportRow>('SELECT id,status,counts_json,errors_json,created_at,completed_at FROM contact_imports WHERE id=? AND api_key_id=?', [id, key.id]);
  if (!row) return errorResponse('Contact import not found.', 404);
  return NextResponse.json(toSummary(row), { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
