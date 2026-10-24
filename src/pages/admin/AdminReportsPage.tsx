import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { listAllAttemptsPage, type AdminAttemptRow } from '../../features/admin/api';
import { Alert, Button, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { ScoreBadge } from '../../components/ScoreBadge';
import { classifyScore } from '../../features/results/score';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function AdminReportsPage() {
  const table = usePageState();
  const onlyFlagged = table.getFilter('flagged') === '1';
  const { data, loading, error } = useAsync(
    () =>
      listAllAttemptsPage({
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
        onlyFlagged,
      }),
    [table.page, table.pageSize, table.q, onlyFlagged],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  const [exporting, setExporting] = useState(false);

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const attempts = data?.rows ?? [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AdminAttemptRow[] = [];
      let exportPage = 1;
      for (;;) {
        const chunk = await listAllAttemptsPage({
          page: exportPage,
          pageSize: 50,
          q: table.q,
          onlyFlagged,
        });
        all.push(...chunk.rows);
        if (chunk.rows.length === 0 || all.length >= chunk.total) break;
        exportPage += 1;
      }
      const csv = toCsv(
      [
        'Student',
        'Email',
        'State',
        'Violations',
        'Submission reason',
        'Earned',
        'Max',
        'Percentage',
        'Result',
        'Started',
        'Submitted',
      ],
        all.map((a) => [
          a.student?.full_name ?? '',
          a.student?.email ?? '',
          a.state,
          a.violation_count,
          a.submission_reason ?? '',
          a.earned_points ?? '',
          a.max_points ?? '',
          a.percentage ?? '',
          classifyScore({
            percentage: a.percentage,
            earnedPoints: a.earned_points,
            maxPoints: a.max_points,
            passThreshold: a.pass_threshold,
            state: a.state,
          }).label,
          a.started_at,
          a.submitted_at ?? '',
        ]),
      );
      downloadCsv('exam-attempts-report.csv', csv);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Result & violation reports</h1>
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search reports"
            placeholder="Search by student…"
            value={table.q}
            onChange={(e) => table.setQuery(e.target.value)}
          />
          <label className="row small">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => table.setFilter('flagged', e.target.checked ? '1' : '')}
            />
            Flagged only
          </label>
          <Button onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>
      <p className="muted small">
        Exports escape spreadsheet-formula injection in user-supplied fields. Only authorized
        records are included.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>State</th>
              <th>Violations</th>
              <th>Reason</th>
              <th>Score</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted center">
                  No attempts match the current filters.
                </td>
              </tr>
            ) : null}
            {attempts.map((attempt: AdminAttemptRow) => (
              <tr key={attempt.id}>
                <td>
                  {attempt.student?.full_name || '—'}
                  <div className="small muted">{attempt.student?.email}</div>
                </td>
                <td>
                  <StatusBadge status={attempt.state} />
                </td>
                <td>{attempt.violation_count}</td>
                <td>{submissionReasonLabel(attempt.submission_reason)}</td>
                <td>
                  {attempt.state === 'submitted' ? (
                    <span>
                      {`${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`}{' '}
                    </span>
                  ) : null}
                  <ScoreBadge
                    percentage={attempt.percentage}
                    earnedPoints={attempt.earned_points}
                    maxPoints={attempt.max_points}
                    passThreshold={attempt.pass_threshold}
                    state={attempt.state}
                  />
                </td>
                <td className="small muted">{formatDateTime(attempt.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        label="attempt reports"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
