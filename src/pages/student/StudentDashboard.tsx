import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { listStudentEnrollments } from '../../features/courses/api';
import { listStudentExams } from '../../features/exams/api';
import { getMyResults } from '../../features/attempts/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageSpinner,
  StatusBadge,
} from '../../components/ui';
import { formatDateTime, percent } from '../../lib/format';

function classifyExam(opensAt: string, closesAt: string): 'available' | 'upcoming' | 'closed' {
  const now = Date.now();
  if (now < new Date(opensAt).getTime()) return 'upcoming';
  if (now >= new Date(closesAt).getTime()) return 'closed';
  return 'available';
}

export function StudentDashboard() {
  const enrollments = useAsync(() => listStudentEnrollments(), []);
  const exams = useAsync(() => listStudentExams(), []);
  const results = useAsync(() => getMyResults(), []);

  const refreshAll = () => {
    void enrollments.reload();
    void exams.reload();
    void results.reload();
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1>Student dashboard</h1>
          <p className="muted">Your courses and available examinations.</p>
        </div>
        <div className="row">
          <Button size="sm" onClick={refreshAll}>
            Refresh availability
          </Button>
          <Link className="btn btn-primary btn-sm" to="/student/join">
            Join a course
          </Link>
        </div>
      </div>

      {enrollments.loading ? <PageSpinner /> : null}
      {enrollments.error ? <Alert tone="danger" role="alert">{enrollments.error}</Alert> : null}

      <Card>
        <h2>My courses</h2>
        {enrollments.data && enrollments.data.length === 0 ? (
          <EmptyState title="You are not enrolled in any course yet">
            <p className="muted">Ask your teacher for a join code.</p>
            <Link className="btn btn-primary" to="/student/join">
              Join a course
            </Link>
          </EmptyState>
        ) : null}
        {enrollments.data && enrollments.data.length > 0 ? (
          <div className="grid">
            {enrollments.data.map((enrollment) => (
              <Card key={enrollment.id} className="stat">
                <div className="row-between">
                  <strong className="mono">{enrollment.course?.course_code ?? '—'}</strong>
                  <StatusBadge status={enrollment.status} />
                </div>
                <h3 className="mt-1">{enrollment.course?.title ?? 'Course'}</h3>
                {enrollment.status === 'approved' && enrollment.course ? (
                  <Link className="btn btn-sm" to={`/student/courses/${enrollment.course.id}`}>
                    Open course
                  </Link>
                ) : (
                  <p className="muted small mt-1">
                    {enrollment.status === 'pending'
                      ? 'Awaiting teacher approval.'
                      : 'Enrollment is not active.'}
                  </p>
                )}
              </Card>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2>Available examinations</h2>
        {exams.loading ? <PageSpinner /> : null}
        {exams.error ? <Alert tone="danger">{exams.error}</Alert> : null}
        {exams.data && exams.data.length === 0 ? (
          <EmptyState title="No published examinations">
            <p className="muted">Published exams for your approved courses appear here.</p>
          </EmptyState>
        ) : null}
        {exams.data && exams.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exams.data.map((exam) => {
                  const status = classifyExam(exam.opens_at, exam.closes_at);
                  return (
                    <tr key={exam.id}>
                      <td>{exam.title}</td>
                      <td className="mono small">{exam.course_code ?? exam.course_title}</td>
                      <td>
                        <Badge
                          tone={
                            status === 'available'
                              ? 'success'
                              : status === 'upcoming'
                                ? 'info'
                                : 'default'
                          }
                        >
                          {status}
                        </Badge>
                      </td>
                      <td>{exam.duration_minutes} min</td>
                      <td className="small muted">
                        {formatDateTime(exam.opens_at)} → {formatDateTime(exam.closes_at)}
                      </td>
                      <td>
                        <Link className="btn btn-sm" to={`/student/exams/${exam.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="row-between">
          <h2>Recent results</h2>
          <Link className="btn btn-sm" to="/student/history">
            Full history
          </Link>
        </div>
        {results.loading ? <PageSpinner /> : null}
        {results.error ? <Alert tone="danger">{results.error}</Alert> : null}
        {results.data && results.data.length === 0 ? (
          <EmptyState title="No results yet">
            <p className="muted">Completed attempts and released scores appear here.</p>
          </EmptyState>
        ) : null}
        {results.data && results.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Attempt</th>
                  <th>Score</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.data.slice(0, 5).map((row) => (
                  <tr key={row.id}>
                    <td>{row.exam_title ?? '—'}</td>
                    <td className="small muted">#{row.attempt_no}</td>
                    <td>
                      {!row.released ? (
                        <span className="muted small">Pending release</span>
                      ) : (
                        <>
                          {`${row.earned_points ?? 0}/${row.max_points ?? 0} (${percent(row.percentage)})`}
                          {row.passed !== null ? (
                            <>
                              {' '}
                              <Badge tone={row.passed ? 'success' : 'danger'}>
                                {row.passed ? 'passed' : 'failed'}
                              </Badge>
                            </>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="small muted">{formatDateTime(row.submitted_at)}</td>
                    <td>
                      <div className="row">
                        <Link className="btn btn-sm" to={`/student/attempts/${row.id}/result`}>
                          View
                        </Link>
                        {row.review_released ? (
                          <Link className="btn btn-sm" to={`/student/attempts/${row.id}/review`}>
                            Review
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
