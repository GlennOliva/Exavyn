import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getMyResultsPage } from '../../features/attempts/api';
import { Alert, Badge, PageSpinner, StatusBadge } from '../../components/ui';
import { ScoreBadge } from '../../components/ScoreBadge';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';
import { TextInput } from '../../components/ui';

export function HistoryPage() {
  const table = usePageState();
  const { data, loading, error } = useAsync(
    () =>
      getMyResultsPage({
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
      }),
    [table.page, table.pageSize, table.q],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const rows = data?.rows ?? [];

  return (
    <div className="stack">
      <h1>Examination history</h1>
      <TextInput
        type="search"
        aria-label="Search your examination history"
        placeholder="Search by exam title…"
        value={table.q}
        onChange={(e) => table.setQuery(e.target.value)}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Exam</th>
              <th>Attempt</th>
              <th>State</th>
              <th>Reason</th>
              <th>Warnings</th>
              <th>Score</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((attempt) => (
              <tr key={attempt.id}>
                <td>{attempt.exam_title ?? '—'}</td>
                <td className="small muted">#{attempt.attempt_no}</td>
                <td>
                  <StatusBadge status={attempt.state} />
                </td>
                <td className="small">{submissionReasonLabel(attempt.submission_reason)}</td>
                <td>
                  {attempt.violation_count > 0 ? (
                    <Badge tone="warning">{attempt.violation_count}</Badge>
                  ) : (
                    '0'
                  )}
                </td>
                <td>
                  {attempt.state === 'submitted' ? (
                    <>
                      {attempt.released ? (
                        <span>
                          {`${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`}{' '}
                        </span>
                      ) : null}
                      <ScoreBadge
                        percentage={attempt.percentage}
                        passThreshold={attempt.pass_threshold}
                        state={attempt.state}
                        released={attempt.released}
                      />
                    </>
                  ) : (
                    <ScoreBadge
                      percentage={attempt.percentage}
                      passThreshold={attempt.pass_threshold}
                      state={attempt.state}
                      released={attempt.released}
                    />
                  )}
                </td>
                <td className="small muted">{formatDateTime(attempt.started_at)}</td>
                <td>
                  <div className="row">
                    <Link className="btn btn-sm" to={`/student/attempts/${attempt.id}/result`}>
                      View
                    </Link>
                    {attempt.review_released ? (
                      <Link
                        className="btn btn-sm"
                        to={`/student/attempts/${attempt.id}/review`}
                      >
                        Review
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted center">
                  No attempts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination
        label="examination history"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
