import { Button } from './ui';
import {
  PAGE_SIZES,
  pageCount,
  type PageSize,
} from '../lib/pagination';

export interface PaginationProps {
  page: number;
  pageSize: PageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  label: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label,
}: PaginationProps) {
  const pages = pageCount(total, pageSize);
  const safePage = Math.min(Math.max(1, page), pages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(safePage * pageSize, total);

  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span className="pagination-summary" aria-live="polite">
        {total === 0 ? 'No records' : `${start}–${end} of ${total}`}
      </span>
      <label className="pagination-size">
        <span className="small muted">Rows per page</span>
        <select
          aria-label={`Rows per page for ${label}`}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="pagination-controls">
        <Button
          size="sm"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1 || total === 0}
          aria-label={`Previous page of ${label}`}
        >
          ← Previous
        </Button>
        <span className="pagination-page small" aria-current="page">
          Page {safePage} of {pages}
        </span>
        <Button
          size="sm"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= pages || total === 0}
          aria-label={`Next page of ${label}`}
        >
          Next →
        </Button>
      </div>
    </nav>
  );
}
