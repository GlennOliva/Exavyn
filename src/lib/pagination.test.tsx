import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { usePageState } from './pagination';

describe('usePageState', () => {
  it('clears its search, named filters, and page atomically', () => {
    let currentSearch = '';
    function Probe({ children }: { children: ReactNode }) {
      currentSearch = useLocation().search;
      return children;
    }
    const { result } = renderHook(() => usePageState('enrollments_'), {
      wrapper: ({ children }) => (
        <MemoryRouter
          initialEntries={[
            '/?enrollments_q=%25&enrollments_status=approved&enrollments_page=2&exams_q=keep',
          ]}
        >
          <Probe>{children}</Probe>
        </MemoryRouter>
      ),
    });

    expect(result.current.q).toBe('%');
    expect(result.current.getFilter('status')).toBe('approved');
    expect(result.current.page).toBe(2);

    act(() => result.current.clearFilters(['status']));

    expect(result.current.q).toBe('');
    expect(result.current.getFilter('status')).toBe('');
    expect(result.current.page).toBe(1);
    expect(currentSearch).toContain('exams_q=keep');
  });
});
