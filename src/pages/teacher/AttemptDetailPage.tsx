import { useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { listAttemptViolationsPage } from '../../features/results/api';
import { getResult } from '../../features/attempts/api';
import { Alert, Badge, Card, PageSpinner, StatusBadge } from '../../components/ui';
import { ScoreBadge } from '../../components/ScoreBadge';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function AttemptDetailPage() {
  const { attemptId = '' } = useParams();
  const table = usePageState();
  const result = useAsync(() => getResult(attemptId), [attemptId]);
  const violations = useAsync(
    () =>
      listAttemptViolationsPage(attemptId, {
        page: table.page,
        pageSize: table.pageSize,
      }),
    [attemptId, table.page, table.pageSize],
  );
  useClampPage(table.page, table.pageSize, violations.data?.total ?? 0, table.setPage);
  const violationRows = violations.data?.rows ?? [];

  if (result.loading) return <PageSpinner />;
  if (result.error) return <Alert tone="danger" role="alert">{result.error}</Alert>;

  const r = result.data;

  return (
    <div className="stack">
      <h1>Attempt detail</h1>
      <Card>
        <div className="row-between">
          <h2>Result</h2>
          <StatusBadge status={r?.attempt_state ?? 'unknown'} />
        </div>
        {r && r.attempt_state === 'submitted' ? (
          <div className="stat-grid mt-2">
            <div>
              <div className="stat-value">
                {r.earned_points ?? 0}/{r.max_points ?? 0}
              </div>
              <div className="stat-label">Score</div>
            </div>
            <div>
              <div className="stat-value">{percent(r.percentage)}</div>
              <div className="stat-label">Percentage</div>
            </div>
            <div>
              <div className="stat-value">{r.correct_count ?? 0}</div>
              <div className="stat-label">Correct</div>
            </div>
            <div>
              <div className="stat-value">{r.violation_count}</div>
              <div className="stat-label">Violations</div>
            </div>
          </div>
        ) : (
          <p className="muted">This attempt is still in progress.</p>
        )}
        {r ? (
          <p className="mt-2">
            <ScoreBadge
              percentage={r.percentage}
              passThreshold={r.pass_threshold}
              state={r.attempt_state}
            />{' '}
            {r.pass_threshold !== null && r.pass_threshold !== undefined ? (
              <span className="muted small">Pass mark: {percent(r.pass_threshold)}</span>
            ) : (
              <span className="muted small">No passing threshold configured.</span>
            )}
          </p>
        ) : null}
        <p className="mt-2">
          <Badge tone="info">{submissionReasonLabel(r?.submission_reason ?? null)}</Badge>{' '}
          <span className="muted small">Submitted {formatDateTime(r?.submitted_at)}</span>
        </p>
      </Card>

      <Card>
        <h2>Violation timeline</h2>
        {violations.loading ? <PageSpinner /> : null}
        {violations.error ? <Alert tone="danger">{violations.error}</Alert> : null}
        {violations.data && violationRows.length === 0 ? (
          <p className="muted">No violation episodes recorded.</p>
        ) : null}
        {violationRows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Episode</th>
                  <th>Signals</th>
                  <th>Observed</th>
                  <th>Received (server)</th>
                </tr>
              </thead>
              <tbody>
                {violationRows.map((event) => (
                  <tr key={event.id}>
                    <td className="mono small">{event.episode_id.slice(0, 8)}…</td>
                    <td>
                      {event.signals.map((signal) => (
                        <Badge key={signal} tone="warning">
                          {signal}
                        </Badge>
                      ))}
                    </td>
                    <td className="small muted">{formatDateTime(event.observed_at)}</td>
                    <td className="small muted">{formatDateTime(event.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {violations.data ? (
          <Pagination
            label="violation timeline"
            page={table.page}
            pageSize={table.pageSize}
            total={violations.data.total}
            onPageChange={table.setPage}
            onPageSizeChange={table.setPageSize}
          />
        ) : null}
      </Card>
    </div>
  );
}
