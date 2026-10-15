import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { listExamAttempts } from '../../features/results/api';
import { Alert, Button, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';

export function ExamResultsPage() {
  const { examId = '' } = useParams();
  const { data, loading, error, reload } = useAsync(() => listExamAttempts(examId), [examId]);
  const [query, setQuery] = useState('');

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const needle = query.trim().toLowerCase();
  const attempts = (data ?? []).filter((a) => {
    if (!needle) return true;
    return (
      (a.student?.full_name ?? '').toLowerCase().includes(needle) ||
      (a.student?.email ?? '').toLowerCase().includes(needle)
    );
  });

  const exportCsv = () => {
    const csv = toCsv(
      ['Student', 'Email', 'State', 'Violations', 'Reason', 'Earned', 'Max', 'Percentage', 'Submitted'],
      attempts.map((a) => [
        a.student?.full_name ?? '',
        a.student?.email ?? '',
        a.state,
        a.violation_count,
        a.submission_reason ?? '',
        a.earned_points ?? '',
        a.max_points ?? '',
        a.percentage ?? '',
        a.submitted_at ?? '',
      ]),
    );
    downloadCsv(`exam-${examId}-results.csv`, csv);
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button onClick={() => void reload()}>Refresh</Button>
          <Button onClick={exportCsv} disabled={attempts.length === 0}>
            Export CSV
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
                  {attempt.state === 'submitted'
                    ? `${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`
                    : 'In progress'}
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
    </div>
  );
}
