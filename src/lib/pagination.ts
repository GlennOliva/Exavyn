import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export const PAGE_SIZES = [10, 25, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

export interface PageResult<T> {
  rows: T[];
  total: number;
}

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

export function parsePageSize(value: string | null | undefined): PageSize {
  const parsed = Number(value);
  return Number.isFinite(parsed) && isPageSize(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

export function parsePage(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/** Inclusive PostgREST range plus the offset used by SQL RPC pagination. */
export function pageRange(page: number, pageSize: number): {
  from: number;
  to: number;
  offset: number;
  limit: number;
} {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.floor(pageSize));
  const offset = (safePage - 1) * safeSize;
  return { from: offset, to: offset + safeSize - 1, offset, limit: safeSize };
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Page/filter/size state kept in the URL so ordinary navigation (back/forward,
 * opening a detail page and returning) preserves the table view. Changing a
 * search term, filter, or page size resets to page 1.
 */
export interface PageState {
  page: number;
  pageSize: PageSize;
  q: string;
  getFilter: (key: string) => string;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
  setQuery: (value: string) => void;
  setFilter: (key: string, value: string) => void;
  clearFilters: (filterKeys: string[]) => void;
  reset: () => void;
}

export function usePageState(prefix = ''): PageState {
  const [params, setParams] = useSearchParams();
  const key = useCallback(
    (name: string) => (prefix ? `${prefix}${name}` : name),
    [prefix],
  );
  const page = parsePage(params.get(key('page')));
  const pageSize = parsePageSize(params.get(key('pageSize')));
  const q = params.get(key('q')) ?? '';

  const commit = useCallback(
    (mutate: (next: URLSearchParams) => void, replace: boolean) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          mutate(next);
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const resetPage = useCallback(
    (next: URLSearchParams) => next.delete(key('page')),
    [key],
  );

  const setPage = useCallback(
    (value: number) => {
      commit((next) => {
        const safe = Math.max(1, Math.floor(value));
        if (safe <= 1) next.delete(key('page'));
        else next.set(key('page'), String(safe));
      }, false);
    },
    [commit, key],
  );

  const setPageSize = useCallback(
    (size: PageSize) => {
      commit((next) => {
        next.set(key('pageSize'), String(size));
        resetPage(next);
      }, false);
    },
    [commit, key, resetPage],
  );

  const setQuery = useCallback(
    (value: string) => {
      commit((next) => {
        if (value.trim()) next.set(key('q'), value);
        else next.delete(key('q'));
        resetPage(next);
      }, true);
    },
    [commit, key, resetPage],
  );

  const setFilter = useCallback(
    (name: string, value: string) => {
      commit((next) => {
        if (value) next.set(key(name), value);
        else next.delete(key(name));
        resetPage(next);
      }, false);
    },
    [commit, key, resetPage],
  );

  const clearFilters = useCallback(
    (filterKeys: string[]) => {
      commit((next) => {
        next.delete(key('q'));
        resetPage(next);
        for (const filterKey of filterKeys) next.delete(key(filterKey));
      }, true);
    },
    [commit, key, resetPage],
  );

  const reset = useCallback(() => {
    setParams(new URLSearchParams(), { replace: false });
  }, [setParams]);

  const getFilter = useCallback((name: string) => params.get(key(name)) ?? '', [params, key]);

  return {
    page,
    pageSize,
    q,
    getFilter,
    setPage,
    setPageSize,
    setQuery,
    setFilter,
    clearFilters,
    reset,
  };
}

/**
 * Keep the current page inside the result set after a deletion/archive shrinks
 * the last page. Uses the URL state so the refetch uses the corrected page.
 */
export function useClampPage(
  page: number,
  pageSize: number,
  total: number,
  setPage: (page: number) => void,
): void {
  useEffect(() => {
    if (total <= 0) return;
    const last = pageCount(total, pageSize);
    if (page > last) setPage(last);
  }, [page, pageSize, total, setPage]);
}

/** Escape user input for a PostgREST `or`/`ilike` expression. */
export function escapePostgrestSearch(value: string): string {
  return value.trim().replace(/[,%()\\]/g, ' ').replace(/\s+/g, ' ');
}
