import { useAsync } from '../../lib/useAsync';
import { listAuditLogsPage } from '../../features/admin/api';
import { Alert, PageSpinner, TextInput } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';

export function AdminAuditPage() {
  const table = usePageState();
  const { data, loading, error } = useAsync(
    () => listAuditLogsPage({ page: table.page, pageSize: table.pageSize, q: table.q }),
    [table.page, table.pageSize, table.q],
  );
  useClampPage(table.page, table.pageSize, data?.total ?? 0, table.setPage);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  return (
    <div className="stack">
      <h1>Administrative audit logs</h1>
      <p className="muted small">Append-only. Records cannot be edited or deleted.</p>
      <TextInput
        type="search"
        aria-label="Search audit logs"
        placeholder="Search by action or entity type…"
        value={table.q}
        onChange={(e) => table.setQuery(e.target.value)}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="muted center">
                  No audit records match the current search.
                </td>
              </tr>
            ) : null}
            {data?.rows.map((log) => (
              <tr key={log.id}>
                <td className="small muted">{formatDateTime(log.created_at)}</td>
                <td>
                  <span className="mono">{log.action}</span>
                </td>
                <td className="small">{log.entity_type}</td>
                <td className="small mono">{JSON.stringify(log.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        label="audit logs"
        page={table.page}
        pageSize={table.pageSize}
        total={data?.total ?? 0}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />
    </div>
  );
}
