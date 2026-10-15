import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import {
  listUsers,
  provisionTeacher,
  setAccountStatus,
  setRole,
  type AdminUser,
} from '../../features/admin/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Modal,
  PageSpinner,
  StatusBadge,
  TextInput,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import type { AppRole } from '../../lib/database.types';

export function AdminUsersPage() {
  const { data, loading, error, reload } = useAsync(() => listUsers(), []);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | AppRole>('all');

  const run = async (fn: () => Promise<void>, message: string) => {
    setActionError(null);
    try {
      await fn();
      setNotice(message);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const changeRole = (user: AdminUser, role: AppRole) =>
    run(() => setRole(user.id, role), `Role updated for ${user.email ?? user.id}.`);

  const toggleStatus = (user: AdminUser) =>
    run(
      () => setAccountStatus(user.id, user.status === 'active' ? 'suspended' : 'active'),
      `Account ${user.status === 'active' ? 'suspended' : 'reactivated'}.`,
    );

  const needle = query.trim().toLowerCase();
  const filteredUsers = (data ?? []).filter((user) => {
    if (roleFilter !== 'all' && (user.role ?? 'student') !== roleFilter) return false;
    if (!needle) return true;
    return (
      (user.full_name ?? '').toLowerCase().includes(needle) ||
      (user.email ?? '').toLowerCase().includes(needle)
    );
  });

  return (
    <div className="stack">
      <div className="row-between">
        <h1>User management</h1>
        <Button variant="primary" onClick={() => setShowProvision(true)}>
          Provision teacher
        </Button>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="danger" role="alert">{actionError}</Alert> : null}
      {loading ? <PageSpinner /> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      {data ? (
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search users"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | AppRole)}
          >
            <option value="all">All roles</option>
            <option value="student">student</option>
            <option value="teacher">teacher</option>
            <option value="admin">admin</option>
          </select>
        </div>
      ) : null}

      {data ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name || '—'}</td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      aria-label={`Role for ${user.email}`}
                      value={user.role ?? 'student'}
                      onChange={(e) => void changeRole(user, e.target.value as AppRole)}
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="small muted">{formatDateTime(user.created_at)}</td>
                  <td>
                    <Button size="sm" onClick={() => void toggleStatus(user)}>
                      {user.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Card>
        <Badge tone="info">Policy</Badge>{' '}
        <span className="small muted">
          Administrators cannot edit finalized scores, reopen attempts, or change their own role
          or status. Archived records are preserved.
        </span>
      </Card>

      {showProvision ? (
        <ProvisionTeacherModal
          onClose={() => setShowProvision(false)}
          onDone={async () => {
            setShowProvision(false);
            setNotice('Teacher account provisioned.');
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ProvisionTeacherModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await provisionTeacher({ email, password, fullName });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Provision a teacher account" onClose={onClose}>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <form onSubmit={submit}>
        <Field label="Full name" htmlFor="tName">
          <TextInput id="tName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="tEmail">
          <TextInput
            id="tEmail"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Temporary password" htmlFor="tPassword" hint="At least 8 characters.">
          <TextInput
            id="tPassword"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="row-between">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create teacher'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
