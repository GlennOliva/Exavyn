import { useAsync } from '../../lib/useAsync';
import { listAllCoursesPage, type AdminCoursePageRow } from '../../features/admin/api';
import { Alert, Badge, PageSpinner, TextInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function AdminCoursesPage() {
  const table = usePageState();
  const archived = (table.getFilter('archived') || 'all') as 'all' | 'active' | 'archived';
  const { data, loading, error } = useAsync(
    () =>
      listAllCoursesPage({
        page: table.page,
        pageSize: table.pageSize,
        q: table.q,
        archived,
      }),
    [table.page, table.pageSize, table.q, archived],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  const courses = (data?.rows ?? []) as AdminCoursePageRow[];

  return (
    <div className="stack">
      <h1>Course directory</h1>
      <div className="row">
        <TextInput
          type="search"
          aria-label="Search courses"
          placeholder="Search by code, title, section, or owner…"
          value={table.q}
          onChange={(e) => table.setQuery(e.target.value)}
        />
        <select
          aria-label="Filter by archive state"
          value={archived}
          onChange={(e) =>
            table.setFilter('archived', e.target.value === 'all' ? '' : e.target.value)
          }
        >
          <option value="all">All courses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
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
            {courses.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted center">
                  No courses match the current filters.
                </td>
              </tr>
            ) : null}
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
      <Pagination
        label="courses"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
