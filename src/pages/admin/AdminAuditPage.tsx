import { useAsync } from '../../lib/useAsync';
import { listAuditLogs } from '../../features/admin/api';
import { Alert, PageSpinner } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function AdminAuditPage() {
  const { data, loading, error } = useAsync(() => listAuditLogs(), []);
  if (loading) return <PageSpinner />;
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;

  return (
    <div className="stack">
      <h1>Administrative audit logs</h1>
      <p className="muted small">Append-only. Records cannot be edited or deleted.</p>
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
            {data?.map((log) => (
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
    </div>
  );
}
