import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { listExamAttemptsPage, type AttemptWithStudent } from '../../features/results/api';
import { Alert, Button, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { ScoreBadge } from '../../components/ScoreBadge';
import { classifyScore } from '../../features/results/score';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function ExamResultsPage() {
  const { examId = '' } = useParams();
  const table = usePageState();
  const { data, loading, error, reload } = useAsync(
    () =>
      listExamAttemptsPage(examId, {
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
      }),
    [examId, table.page, table.pageSize, table.q],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  const [exporting, setExporting] = useState(false);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const attempts = data?.rows ?? [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AttemptWithStudent[] = [];
      let exportPage = 1;
      for (;;) {
        const chunk = await listExamAttemptsPage(examId, {
          page: exportPage,
          pageSize: 50,
          q: table.q,
        });
        all.push(...chunk.rows);
        if (chunk.rows.length === 0 || all.length >= chunk.total) break;
        exportPage += 1;
      }
      const csv = toCsv(
      ['Student', 'Email', 'State', 'Violations', 'Reason', 'Earned', 'Max', 'Percentage', 'Result', 'Submitted'],
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
          passThreshold: a.pass_threshold,
          state: a.state,
        }).label,
        a.submitted_at ?? '',
      ]),
      );
      downloadCsv(`exam-${examId}-results.csv`, csv);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <h1>Exam results</h1>
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search results"
            placeholder="Search by student…"
            value={table.q}
            onChange={(e) => table.setQuery(e.target.value)}
          />
          <Button onClick={() => void reload()}>Refresh</Button>
          <Button onClick={() => void exportCsv()} disabled={exporting || (data?.total ?? 0) === 0}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>
      <p className="muted small">
        Finalized results are immutable. Submission reasons: manual, violation limit, or time
        expired.
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
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => (
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
                    <>
                      {`${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`}{' '}
                    </>
                  ) : null}
                  <ScoreBadge
                    percentage={attempt.percentage}
                    passThreshold={attempt.pass_threshold}
                    state={attempt.state}
                  />
                </td>
                <td className="small muted">{formatDateTime(attempt.submitted_at)}</td>
                <td>
                  <Link className="btn btn-sm" to={`/teacher/attempts/${attempt.id}`}>
                    Details
                  </Link>
                </td>
              </tr>
            ))}
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted center">
                  No attempts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination
        label="exam results"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
