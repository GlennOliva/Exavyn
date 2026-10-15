import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { listAllAttempts, type AdminAttemptRow } from '../../features/admin/api';
import { Alert, Button, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { downloadCsv, toCsv } from '../../lib/csv';
import { formatDateTime, percent, submissionReasonLabel } from '../../lib/format';

export function AdminReportsPage() {
  const { data, loading, error } = useAsync(() => listAllAttempts(), []);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [query, setQuery] = useState('');

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const needle = query.trim().toLowerCase();
  const attempts = (data ?? []).filter((a) => {
    if (onlyFlagged && a.violation_count <= 0) return false;
    if (!needle) return true;
    return (
      (a.student?.full_name ?? '').toLowerCase().includes(needle) ||
      (a.student?.email ?? '').toLowerCase().includes(needle)
    );
  });

  const exportCsv = () => {
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
        'Started',
        'Submitted',
      ],
      attempts.map((a) => [
        a.student?.full_name ?? '',
        a.student?.email ?? '',
        a.state,
        a.violation_count,
        a.submission_reason ?? '',
        a.earned_points ?? '',
        a.max_points ?? '',
        a.percentage ?? '',
        a.started_at,
        a.submitted_at ?? '',
      ]),
    );
    downloadCsv('exam-attempts-report.csv', csv);
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="row small">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Flagged only
          </label>
          <Button onClick={exportCsv}>Export CSV</Button>
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
                  {attempt.state === 'submitted'
                    ? `${attempt.earned_points ?? 0}/${attempt.max_points ?? 0} (${percent(attempt.percentage)})`
                    : '—'}
                </td>
                <td className="small muted">{formatDateTime(attempt.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
