import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query } from '@/lib/database';
import { listDashboardApiLogs } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvValue(value: string | number | null) {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportCsv(url: URL) {
  const search = url.searchParams.get('search')?.trim().slice(0, 100) ?? '';
  const rawStatus = url.searchParams.get('status') ?? '';
  const status = rawStatus && rawStatus !== 'errors' && rawStatus !== 'success' ? Number(rawStatus) : rawStatus;
  if (typeof status === 'number' && (!Number.isInteger(status) || status < 100 || status > 599)) return NextResponse.json({ error: { message: 'status must be errors, success, or an HTTP status from 100 to 599.' } }, { status: 400 });
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (search) { clauses.push('(id LIKE ? OR endpoint LIKE ? OR method LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status === 'errors') clauses.push('response_status >= 400');
  else if (status === 'success') clauses.push('response_status < 400');
  else if (typeof status === 'number') { clauses.push('response_status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('id,created_at,endpoint,method,response_status,user_agent\r\n'));
      let cursor: { id: string; created_at: string } | undefined;
      try {
        while (true) {
          const cursorClause = cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : '';
          const cursorParams = cursor ? [cursor.created_at, cursor.created_at, cursor.id] : [];
          const rows = (await query<{ id: string; created_at: string; endpoint: string; method: string; response_status: number; user_agent: string | null }>(`SELECT id,created_at,endpoint,method,response_status,user_agent FROM api_request_logs ${where}${cursorClause} ORDER BY created_at DESC,id DESC LIMIT 500`, [...params, ...cursorParams])).rows;
          for (const row of rows) controller.enqueue(encoder.encode([row.id, row.created_at, row.endpoint, row.method, row.response_status, row.user_agent].map(csvValue).join(',') + '\r\n'));
          if (rows.length < 500) break;
          cursor = rows[rows.length - 1];
        }
        controller.close();
      } catch {
        controller.error(new Error('Could not export API request logs.'));
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="send-thanks-request-logs.csv"', 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in to view API request logs.' }, { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') return await exportCsv(url);
  const result = await listDashboardApiLogs(url);
  if ('error' in result) return NextResponse.json({ error: { message: result.error } }, { status: 400 });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
