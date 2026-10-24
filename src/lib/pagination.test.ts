import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  escapePostgrestSearch,
  pageCount,
  pageRange,
  parsePage,
  parsePageSize,
} from './pagination';

describe('pagination helpers', () => {
  it('defaults to 10 rows per page and rejects unsupported sizes', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(10);
    expect(parsePageSize(null)).toBe(10);
    expect(parsePageSize('25')).toBe(25);
    expect(parsePageSize('20')).toBe(10);
  });

  it('parses pages defensively', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-2')).toBe(1);
    expect(parsePage('abc')).toBe(1);
  });

  it('computes inclusive PostgREST ranges', () => {
    expect(pageRange(1, 10)).toMatchObject({ from: 0, to: 9, offset: 0, limit: 10 });
    expect(pageRange(3, 25)).toMatchObject({ from: 50, to: 74, offset: 50, limit: 25 });
  });

  it('computes the last page', () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(1, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
  });

  it('strips PostgREST syntax from search input', () => {
    expect(escapePostgrestSearch('  a,b(c)%\\d  ')).toBe('a b c d');
  });
});
