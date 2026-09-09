import { ApiError } from '../routes/api-error.js';

export function parseCsv(
  input: string,
  maxRows = 251,
  limitMessage = 'Import at most 250 employees at a time.',
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  const text = input.replace(/^\uFEFF/, '');
  const cell = () => {
    row.push(value.trim());
    value = '';
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new ApiError(400, limitMessage);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === ',') {
      cell();
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
      continue;
    }
    if (closed && c.trim())
      throw new ApiError(
        400,
        'Invalid CSV: unexpected text after a closing quote.',
      );
    if (c === '"') {
      if (value.trim() || closed)
        throw new ApiError(400, 'Invalid CSV quote. Quote the entire field.');
      quoted = true;
      value = '';
    } else if (!closed) value += c;
  }
  if (quoted)
    throw new ApiError(400, 'Invalid CSV: a quoted field is not closed.');
  if (value || row.length || closed) line();
  return rows;
}
