import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getMyResults } from '../../features/attempts/api';
import { Alert, Badge, PageSpinner, StatusBadge } from '../../components/ui';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';

export function HistoryPage() {
  const { data, loading, error } = useAsync(() => getMyResults(), []);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const rows = data ?? [];

  return (
    <div className="stack">
      <h1>Examination history</h1>
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
                  {!attempt.released ? (
                    <span className="muted small">Pending release</span>
                  ) : attempt.state === 'submitted' ? (
                    <>
                      {`${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`}
                      {attempt.passed !== null ? (
                        <>
                          {' '}
                          <Badge tone={attempt.passed ? 'success' : 'danger'}>
                            {attempt.passed ? 'passed' : 'failed'}
                          </Badge>
                        </>
                      ) : null}
                    </>
                  ) : (
                    '—'
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
    </div>
  );
}
