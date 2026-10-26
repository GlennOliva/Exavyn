import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import {
  listExamAttemptsPage,
  type AttemptResultRow,
} from '../../features/results/api';
import {
  Alert,
  Button,
  EmptyState,
  PageSpinner,
  StatusBadge,
  TextInput,
} from '../../components/ui';
import { ScoreBadge } from '../../components/ScoreBadge';
import { classifyScore } from '../../features/results/score';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { Pagination } from '../../components/Pagination';
import type { AttemptState } from '../../lib/database.types';

type ResultStateFilter = 'all' | AttemptState;

export function ExamResultsPage() {
  const { examId = '' } = useParams();
  const table = usePageState();
  const debouncedQuery = useDebouncedValue(table.q, 300);
  const searchPending = table.q !== debouncedQuery;
  const rawState = table.getFilter('state');
  const stateFilter: ResultStateFilter =
    rawState === 'in_progress' || rawState === 'submitted' ? rawState : 'all';

  const { data, loading, error, reload } = useAsync(
    () =>
      listExamAttemptsPage(examId, {
        page: table.page,
        pageSize: table.pageSize,
        q: debouncedQuery,
        state: stateFilter,
      }),
    [examId, table.page, table.pageSize, debouncedQuery, stateFilter],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  const [exporting, setExporting] = useState(false);
  const attempts = data?.rows ?? [];
  const total = data?.total ?? 0;
  const busy = loading || searchPending;
  const filtersActive = debouncedQuery.trim().length > 0 || stateFilter !== 'all';

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AttemptResultRow[] = [];
      let exportPage = 1;
      for (;;) {
        const chunk = await listExamAttemptsPage(examId, {
          page: exportPage,
          pageSize: 50,
          q: debouncedQuery,
          state: stateFilter,
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
          'Reason',
          'Earned',
          'Max',
          'Percentage',
          'Result',
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
          a.submitted_at ?? '',
        ]),
      );
      downloadCsv(`exam-${examId}-results.csv`, csv);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack" aria-busy={busy}>
      <div className="row-between">
        <h1>Exam results</h1>
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search results"
            placeholder="Search students by name or email…"
            value={table.q}
            onChange={(e) => table.setQuery(e.target.value)}
          />
          <select
            aria-label="Filter attempt state"
            value={stateFilter}
            onChange={(e) =>
              table.setFilter('state', e.target.value === 'all' ? '' : e.target.value)
            }
          >
            <option value="all">All states</option>
            <option value="in_progress">in_progress</option>
            <option value="submitted">submitted</option>
          </select>
          <Button onClick={() => void reload()}>Refresh</Button>
          <Button
            onClick={() => void exportCsv()}
            disabled={busy || exporting || total === 0}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>
      <p className="muted small">
        Finalized results are immutable. Submission reasons: manual, violation limit, or time
        expired.
      </p>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {busy ? <PageSpinner /> : null}
      {!busy && !error && data && attempts.length === 0 ? (
        filtersActive ? (
          <EmptyState title="No matching results">
            <p className="muted">Try another name or email, or clear the current filters.</p>
            <Button size="sm" onClick={() => table.clearFilters(['state'])}>
              Clear search and filters
            </Button>
          </EmptyState>
        ) : (
          <EmptyState title="No attempts yet">
            <p className="muted">Results appear here after students start the exam.</p>
          </EmptyState>
        )
      ) : null}
      {!busy && !error && attempts.length > 0 ? (
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
                      earnedPoints={attempt.earned_points}
                      maxPoints={attempt.max_points}
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
            </tbody>
          </table>
        </div>
      ) : null}
      {!busy && !error && data ? (
        <Pagination
          label="exam results"
          page={table.page}
          pageSize={table.pageSize}
          total={total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
        />
      ) : null}
    </div>
  );
}
