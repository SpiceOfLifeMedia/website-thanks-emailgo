import { NextResponse } from 'next/server';
import { hasTrustedBrowserOrigin, isAdminSession } from '@/lib/auth';
import { importContactsCsv } from '@/lib/contact-import';

export const runtime = 'nodejs';
export const maxDuration = 30;

const maxFileBytes = 2_000_000;

export async function POST(request: Request) {
  if (!hasTrustedBrowserOrigin(request)) return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  if (!await isAdminSession()) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxFileBytes + 100_000) return NextResponse.json({ error: 'CSV uploads are limited to 2 MB.' }, { status: 413 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Upload a valid multipart CSV form.' }, { status: 400 }); }
  const fileValue = form.get('file');
  if (!fileValue || typeof fileValue === 'string' || typeof (fileValue as File).arrayBuffer !== 'function') return NextResponse.json({ error: 'Choose a CSV file to import.' }, { status: 400 });
  const file = fileValue as File;
  if (file.size > maxFileBytes) return NextResponse.json({ error: 'CSV uploads are limited to 2 MB.' }, { status: 413 });
  if (file.name && !file.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ error: 'Choose a file with a .csv extension.' }, { status: 400 });
  const mode = form.get('mode') ?? 'skip';
  if (mode !== 'skip' && mode !== 'upsert') return NextResponse.json({ error: 'mode must be skip or upsert.' }, { status: 400 });

  let csv: string;
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { return NextResponse.json({ error: 'The CSV file must use valid UTF-8 text.' }, { status: 400 }); }
  return importContactsCsv(csv, mode);
}
