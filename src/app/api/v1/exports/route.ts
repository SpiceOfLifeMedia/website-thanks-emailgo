import { NextResponse } from 'next/server';
import { authorizeApiKey, hasFullApiAccess } from '@/lib/auth';
import { query } from '@/lib/database';
import { sanitizeCustomerCopy } from '@/lib/customer-copy';
import { buildExportPageQuery, exportFields, isExportResource, serializeCsvRow, type ExportCursor, type ExportResource } from '@/lib/csv-export';
import { withApiRequestLog } from '@/lib/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const privateHeaders = { 'Cache-Control': 'private, no-store' };
const pageSize = 500;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status, headers: privateHeaders });
}

function csvValue(resource: ExportResource, field: string, value: unknown) {
  if (resource === 'emails' && field === 'error' && typeof value === 'string') return sanitizeCustomerCopy(value);
  return value;
}

async function __emailgo_GET_handler(request: Request) {
  const apiKey = await authorizeApiKey(request);
  if (!apiKey) return errorResponse('Invalid or revoked API key.', 401);
  if (!hasFullApiAccess(apiKey)) return errorResponse('This API key has sending-only access.', 403);

  const url = new URL(request.url);
  const resourceValue = url.searchParams.get('resource');
  if (!isExportResource(resourceValue)) return errorResponse('resource must be emails, received_emails, broadcasts, contacts, domains, logs or api_keys.', 400);
  const rawSearch = url.searchParams.get('search');
  if (rawSearch !== null && rawSearch.length > 100) return errorResponse('search must be no more than 100 characters.', 400);
  const filter = { search: rawSearch?.trim() ?? '', status: url.searchParams.get('status') ?? '' };
  const validation = buildExportPageQuery(resourceValue, apiKey.id, filter, null, pageSize, apiKey.workspaceId);
  if ('error' in validation) return errorResponse(validation.error, 400);

  const fields = exportFields(resourceValue);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`\uFEFF${serializeCsvRow(fields)}\r\n`));
      let cursor: ExportCursor | null = null;
      try {
        while (true) {
          const page = buildExportPageQuery(resourceValue, apiKey.id, filter, cursor, pageSize, apiKey.workspaceId);
          if ('error' in page) throw new Error('Export filters are invalid.');
          const rows = (await query<Record<string, unknown> & { id: string; export_cursor: string }>(page.sql, page.params)).rows;
          for (const row of rows) {
            controller.enqueue(encoder.encode(`${serializeCsvRow(fields.map((field) => csvValue(resourceValue, field, row[field])))}\r\n`));
          }
          if (rows.length < pageSize) break;
          const last = rows[rows.length - 1];
          cursor = { id: last.id, sortAt: last.export_cursor };
        }
        controller.close();
      } catch {
        controller.error(new Error('Could not complete the CSV export.'));
      }
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      ...privateHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="send-thanks-${resourceValue}-${day}.csv"`,
    },
  });
}

export const GET = withApiRequestLog(__emailgo_GET_handler);
