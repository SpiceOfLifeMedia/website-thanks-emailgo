import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query } from '@/lib/database';
import { stringifyCsv } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExportContact = {
  id: string;
  email: string;
  name: string | null;
  properties_json: string;
  tags_json: string;
  unsubscribed_at: string | null;
  consent_status: 'unknown' | 'opted_in';
  consent_source: string | null;
  consented_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const count = await query<{ count: number }>('SELECT count(*) AS count FROM contacts');
  if (Number(count.rows[0]?.count ?? 0) > 10_000) return NextResponse.json({ error: 'This dashboard export is limited to 10,000 contacts. Use paginated API reads for larger workspaces.' }, { status: 413 });
  const contacts = await query<ExportContact>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status,consent_source,consented_at,created_at,updated_at FROM contacts ORDER BY created_at DESC,id DESC');
  const rows: unknown[][] = [['id', 'email', 'name', 'properties', 'tags', 'unsubscribed', 'unsubscribed_at', 'consent_status', 'consent_source', 'consented_at', 'created_at', 'updated_at']];
  for (const contact of contacts.rows) {
    rows.push([
      contact.id,
      contact.email,
      contact.name ?? '',
      contact.properties_json,
      contact.tags_json,
      contact.unsubscribed_at ? 'true' : 'false',
      contact.unsubscribed_at ?? '',
      contact.consent_status,
      contact.consent_source ?? '',
      contact.consented_at ?? '',
      contact.created_at,
      contact.updated_at,
    ]);
  }
  const csv = `\uFEFF${stringifyCsv(rows)}`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="emailgo-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
