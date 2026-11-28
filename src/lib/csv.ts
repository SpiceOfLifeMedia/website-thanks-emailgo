export function parseCsv(input: string, maxRows = 2_000): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const source = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; quoteClosed = true; }
      } else field += character;
      continue;
    }
    if (character === '"') {
      if (field.length > 0 || quoteClosed) return { ok: false, error: `Unexpected quote near character ${index + 1}.` };
      quoted = true;
      continue;
    }
    if (quoteClosed && character !== ',' && character !== '\n' && character !== '\r' && !/\s/.test(character)) return { ok: false, error: `Unexpected character after a quoted field near character ${index + 1}.` };
    if (character === ',') {
      row.push(field);
      field = '';
      quoteClosed = false;
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      if (rows.length > maxRows + 1) return { ok: false, error: `CSV may contain at most ${maxRows} contact rows.` };
      row = [];
      field = '';
      quoteClosed = false;
      continue;
    }
    if (!quoteClosed) field += character;
  }

  if (quoted) return { ok: false, error: 'CSV ends inside a quoted field.' };
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  if (rows.length > maxRows + 1) return { ok: false, error: `CSV may contain at most ${maxRows} contact rows.` };
  return { ok: true, rows };
}

export function stringifyCsv(rows: readonly (readonly unknown[])[]) {
  return rows.map((row) => row.map((value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
