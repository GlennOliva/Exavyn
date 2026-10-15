import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { listAllCourses } from '../../features/admin/api';
import { Alert, Badge, PageSpinner, TextInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface AdminCourse {
  id: string;
  title: string;
  course_code: string;
  section: string;
  academic_term: string;
  archived: boolean;
  created_at: string;
  owner: { full_name: string; email: string | null } | null;
}

export function AdminCoursesPage() {
  const { data, loading, error } = useAsync(() => listAllCourses(), []);
  const [query, setQuery] = useState('');
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const needle = query.trim().toLowerCase();
  const courses = ((data as unknown as AdminCourse[] | null) ?? []).filter((course) => {
    if (!needle) return true;
    return (
      course.course_code.toLowerCase().includes(needle) ||
      course.title.toLowerCase().includes(needle) ||
      (course.section ?? '').toLowerCase().includes(needle) ||
      (course.owner?.full_name ?? '').toLowerCase().includes(needle)
    );
  });

  return (
    <div className="stack">
      <h1>Course directory</h1>
      <TextInput
        type="search"
        aria-label="Search courses"
        placeholder="Search by code, title, section, or owner…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th>Section</th>
              <th>Term</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id}>
                <td className="mono">{course.course_code}</td>
                <td>{course.title}</td>
                <td>{course.section || '—'}</td>
                <td>{course.academic_term || '—'}</td>
                <td>{course.owner?.full_name ?? '—'}</td>
                <td>
                  <Badge tone={course.archived ? 'warning' : 'success'}>
                    {course.archived ? 'archived' : 'active'}
                  </Badge>
                </td>
                <td className="small muted">{formatDateTime(course.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
