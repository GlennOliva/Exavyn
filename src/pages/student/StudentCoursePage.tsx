import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { getCourse } from '../../features/courses/api';
import { listStudentExamsPage } from '../../features/exams/api';
import { Alert, Badge, Card, EmptyState, PageSpinner, StatusBadge } from '../../components/ui';
import { formatDateTimeWithZone } from '../../lib/format';
import { examAvailability } from '../../lib/datetime';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function StudentCoursePage() {
  const { courseId = '' } = useParams();
  const table = usePageState();
  const course = useAsync(() => getCourse(courseId), [courseId]);
  const exams = useAsync(
    () =>
      listStudentExamsPage({
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
        courseId,
      }),
    [courseId, table.page, table.pageSize, table.q],
  );
  useClampPage(table.page, table.pageSize, exams.data?.total ?? 0, table.setPage);
  const examRows = exams.data?.rows ?? [];

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
        {exams.data && examRows.length === 0 ? (
          <EmptyState title="No published examinations">
            <p className="muted">Your teacher has not published an exam for this course yet.</p>
          </EmptyState>
        ) : null}
        {examRows.length > 0 ? (
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
                {examRows.map((exam) => {
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
        {exams.data ? (
          <Pagination
            label="published examinations"
            page={table.page}
            pageSize={table.pageSize}
            total={exams.data.total}
            onPageChange={table.setPage}
            onPageSizeChange={table.setPageSize}
          />
        ) : null}
      </Card>
    </div>
  );
}
