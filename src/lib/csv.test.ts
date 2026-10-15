import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from './csv';

describe('escapeCsvCell', () => {
  it('neutralises spreadsheet formula injection', () => {
    expect(escapeCsvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell('@import')).toBe("'@import");
    expect(escapeCsvCell('-1+2')).toBe("'-1+2");
    expect(escapeCsvCell('\tx')).toBe("'\tx");
  });

  it('quotes values that contain commas, quotes, or newlines', () => {
    expect(escapeCsvCell('Smith, John')).toBe('"Smith, John"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises and quotes a formula containing a comma', () => {
    expect(escapeCsvCell('+1,000')).toBe('"\'+1,000"');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('joins headers and rows with CRLF and escapes each cell', () => {
    const csv = toCsv(
      ['name', 'score'],
      [
        ['Ada, Lovelace', '=1+1'],
        ['Grace', 42],
      ],
    );
    expect(csv).toBe('name,score\r\n"Ada, Lovelace",\'=1+1\r\nGrace,42');
  });
});
