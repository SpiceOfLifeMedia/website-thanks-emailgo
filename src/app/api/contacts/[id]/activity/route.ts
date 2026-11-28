import { NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/auth';
import { query, queryOne } from '@/lib/database';
import { contactActivityQuery, decodeContactActivityCursor, encodeContactActivityCursor, safeContactActivityBounce, safeContactActivityDetail, type ContactActivityRow } from '@/lib/contact-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const { id } = await context.params;
  const contact = await queryOne<{ id: string; email: string }>('SELECT id,email FROM contacts WHERE id=?', [id]);
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });

  const url = new URL(request.url);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue === null ? 30 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'limit must be an integer from 1 to 100.' }, { status: 400 });
  const cursor = decodeContactActivityCursor(url.searchParams.get('after'));
  if (cursor === undefined) return NextResponse.json({ error: 'after must be a valid activity cursor.' }, { status: 400 });

  const statement = contactActivityQuery(contact.id, contact.email, cursor, limit, Boolean(process.env.DATABASE_URL));
  const rows = (await query<ContactActivityRow>(statement.sql, statement.params)).rows;
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  const safeData = data.map((row) => {
    const temporaryBounce = row.type === 'delivery.delayed' && /^(Transient|Undetermined)\s*\//.test(row.detail ?? '');
    const type = temporaryBounce ? 'delivery.bounced' : row.type;
    const bounce = type === 'delivery.bounced' ? safeContactActivityBounce(row.detail) : null;
    return {
      ...row,
      type,
      detail: safeContactActivityDetail(type, row.detail),
      ...(bounce ? { bounce_type: bounce.bounceType } : {}),
    };
  });
  return NextResponse.json({
    object: 'list',
    data: safeData,
    has_more: hasMore,
    ...(hasMore && last ? { next_after: encodeContactActivityCursor({ created_at: last.created_at, id: last.id }) } : {}),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
