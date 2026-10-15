import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { listAllExams } from '../../features/admin/api';
import { Alert, PageSpinner, StatusBadge, TextInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function AdminExamsPage() {
  const { data, loading, error } = useAsync(() => listAllExams(), []);
  const [query, setQuery] = useState('');
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const needle = query.trim().toLowerCase();
  const exams = (data ?? []).filter((exam) => {
    if (!needle) return true;
    return exam.title.toLowerCase().includes(needle) || exam.state.toLowerCase().includes(needle);
  });

  return (
    <div className="stack">
      <h1>Examination directory</h1>
      <TextInput
        type="search"
        aria-label="Search exams"
        placeholder="Search by title or state…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
    </div>
  );
}
