export type JsonReadResult = { ok: true; value: unknown } | { ok: false; status: number; error: string };
export type TextReadResult = { ok: true; text: string } | { ok: false; status: number; error: string };

export async function readTextLimited(request: Request, limitBytes: number): Promise<TextReadResult> {
  const maximumDrainBytes = limitBytes * 2;
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  let tooLarge = contentLength > limitBytes;
  if (!request.body) return tooLarge
    ? { ok: false, status: 413, error: `Request body must be smaller than ${limitBytes} bytes.` }
    : { ok: false, status: 400, error: 'Request body must be valid JSON.' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumDrainBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: `Request body must be smaller than ${limitBytes} bytes.` };
      }
      if (totalBytes > limitBytes) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }
      if (!tooLarge) chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Could not read request body.' };
  }
  if (tooLarge) return { ok: false, status: 413, error: `Request body must be smaller than ${limitBytes} bytes.` };
  const content = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, text: new TextDecoder().decode(content) };
}

export async function readJsonLimited(request: Request, limitBytes: number): Promise<JsonReadResult> {
  const text = await readTextLimited(request, limitBytes);
  if (!text.ok) return text;
  try { return { ok: true, value: JSON.parse(text.text) as unknown }; }
  catch { return { ok: false, status: 400, error: 'Request body must be valid JSON.' }; }
}
