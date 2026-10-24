import { useAsync } from '../../lib/useAsync';
import { listAllExamsPage } from '../../features/admin/api';
import { Alert, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';
import type { ExamState } from '../../lib/database.types';

export function AdminExamsPage() {
  const table = usePageState();
  const state = (table.getFilter('state') || 'all') as 'all' | ExamState;
  const { data, loading, error } = useAsync(
    () =>
      listAllExamsPage({
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
        state,
      }),
    [table.page, table.pageSize, table.q, state],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const exams = data?.rows ?? [];

  return (
    <div className="stack">
      <h1>Examination directory</h1>
      <div className="row">
        <TextInput
          type="search"
          aria-label="Search exams"
          placeholder="Search by title or state…"
          value={table.q}
          onChange={(e) => table.setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by exam state"
          value={state}
          onChange={(e) =>
            table.setFilter('state', e.target.value === 'all' ? '' : e.target.value)
          }
        >
          <option value="all">All states</option>
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th>Duration</th>
              <th>Opens</th>
              <th>Closes</th>
              <th>Release</th>
            </tr>
          </thead>
          <tbody>
            {exams.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted center">
                  No examinations match the current filters.
                </td>
              </tr>
            ) : null}
            {exams.map((exam) => (
              <tr key={exam.id}>
                <td>{exam.title}</td>
                <td>
                  <StatusBadge status={exam.archived ? 'archived' : exam.state} />
                </td>
                <td>{exam.duration_minutes} min</td>
                <td className="small muted">{formatDateTime(exam.opens_at)}</td>
                <td className="small muted">{formatDateTime(exam.closes_at)}</td>
                <td>{exam.result_release}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        label="examinations"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
