/**
 * CSV export helpers with spreadsheet-formula-injection protection.
 *
 * Cells whose text begins with `= + - @` (or tab/CR) are neutralised with a
 * leading apostrophe so spreadsheets treat them as text, never as formulas.
 * This is required by the acceptance criteria for user-supplied fields such as
 * names, course titles, and question prompts.
 */

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  let safe = raw;
  if (safe.length > 0 && FORMULA_TRIGGERS.includes(safe[0])) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    safe = `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
