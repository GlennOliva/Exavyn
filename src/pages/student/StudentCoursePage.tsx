import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getCourse } from '../../features/courses/api';
import { listStudentExams } from '../../features/exams/api';
import { Alert, Badge, Card, EmptyState, PageSpinner, StatusBadge } from '../../components/ui';
import { formatDateTimeWithZone } from '../../lib/format';
import { examAvailability } from '../../lib/datetime';

export function StudentCoursePage() {
  const { courseId = '' } = useParams();
  const course = useAsync(() => getCourse(courseId), [courseId]);
  const exams = useAsync(
    async () => (await listStudentExams()).filter((e) => e.course_id === courseId),
    [courseId],
  );

  if (course.loading) return <PageSpinner />;
  if (course.error) return <Alert tone="danger" role="alert">{course.error}</Alert>;
  if (!course.data) return <Alert tone="warning">Course not available.</Alert>;

  return (
    <div className="stack">
      <Link to="/student" className="small">
        ← Dashboard
      </Link>
      <div>
        <h1>
          <span className="mono">{course.data.course_code}</span> · {course.data.title}
        </h1>
        <p className="muted">
          {course.data.section || 'No section'} · {course.data.academic_term || 'No term'}
        </p>
      </div>

      <Card>
        <h2>Published examinations</h2>
        {exams.loading ? <PageSpinner /> : null}
        {exams.data && exams.data.length === 0 ? (
          <EmptyState title="No published examinations">
            <p className="muted">Your teacher has not published an exam for this course yet.</p>
          </EmptyState>
        ) : null}
        {exams.data && exams.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exams.data.map((exam) => {
                  const availability = examAvailability(exam.opens_at, exam.closes_at);
                  const status =
                    availability === 'upcoming'
                      ? 'upcoming'
                      : availability === 'closed'
                        ? 'closed'
                        : 'available';
                  return (
                    <tr key={exam.id}>
                      <td>{exam.title}</td>
                      <td>
                        <Badge
                          tone={status === 'available' ? 'success' : status === 'upcoming' ? 'info' : 'default'}
                        >
                          {status}
                        </Badge>
                      </td>
                      <td>{exam.duration_minutes} min</td>
                      <td className="small muted">
                        {formatDateTimeWithZone(exam.opens_at)} → {formatDateTimeWithZone(exam.closes_at)}
                      </td>
                      <td>
                        {status === 'closed' ? (
                          <StatusBadge status="archived" />
                        ) : (
                          <Link className="btn btn-sm" to={`/student/exams/${exam.id}`}>
                            Instructions
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
