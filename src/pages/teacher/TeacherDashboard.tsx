import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { listTeacherCourses } from '../../features/courses/api';
import { Alert, Card, EmptyState, PageSpinner, StatusBadge } from '../../components/ui';
import { formatDate } from '../../lib/format';

export function TeacherDashboard() {
  const { data, loading, error } = useAsync(() => listTeacherCourses(), []);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h1>Teacher dashboard</h1>
          <p className="muted">Manage your courses, exams, enrollments, and results.</p>
        </div>
        <Link className="btn btn-primary" to="/teacher/courses">
          Manage courses
        </Link>
      </div>

      {!data || data.length === 0 ? (
        <Card>
          <EmptyState title="No courses yet">
            <p className="muted">Create your first course to publish examinations.</p>
            <Link className="btn btn-primary" to="/teacher/courses">
              Create a course
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <div className="grid">
          {data.map((course) => (
            <Card key={course.id}>
              <div className="row-between">
                <strong>{course.course_code}</strong>
                <StatusBadge status={course.archived ? 'archived' : 'active'} />
              </div>
              <h3 className="mt-1">{course.title}</h3>
              <p className="muted small">
                {course.section || 'No section'} · {course.academic_term || 'No term'}
              </p>
              <p className="small muted">Created {formatDate(course.created_at)}</p>
              <Link className="btn btn-sm" to={`/teacher/courses/${course.id}`}>
                Open course
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
