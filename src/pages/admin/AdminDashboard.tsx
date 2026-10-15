import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { finalizeExpiredAttempts } from '../../features/attempts/api';
import { getAdminStats } from '../../features/admin/api';
import { Alert, Button, Card, PageSpinner, StatCard } from '../../components/ui';
import { errorMessage } from '../../lib/errors';

export function AdminDashboard() {
  const { data, loading, error, reload } = useAsync(() => getAdminStats(), []);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1>Administration</h1>
          <p className="muted">Platform-wide overview. Finalized results are immutable.</p>
        </div>
        <Button size="sm" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {data ? (
        <div className="stat-grid">
          <StatCard label="Users" value={data.users} />
          <StatCard label="Teachers" value={data.teachers} />
          <StatCard label="Students" value={data.students} />
          <StatCard label="Courses" value={data.courses} />
          <StatCard label="Exams" value={data.exams} />
          <StatCard label="Published" value={data.published_exams} />
          <StatCard label="Attempts" value={data.attempts} />
          <StatCard label="Submitted" value={data.submitted_attempts} />
          <StatCard label="Flagged" value={data.flagged_attempts} />
        </div>
      ) : null}

      <Card>
        <h2>Operations</h2>
        <div className="row">
          <Button
            onClick={async () => {
              try {
                const count = await finalizeExpiredAttempts();
                setNotice(`Reconciled attempts. Finalized ${count} expired attempt(s).`);
                void reload();
              } catch (err) {
                setNotice(errorMessage(err));
              }
            }}
          >
            Finalize expired attempts now
          </Button>
          <Link className="btn" to="/admin/reports">
            View reports
          </Link>
        </div>
        <p className="muted small mt-2">
          A scheduled database job also finalizes expired attempts even when no browser is open.
        </p>
      </Card>
    </div>
  );
}
