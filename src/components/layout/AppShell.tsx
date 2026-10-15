import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { appName, isSupabaseConfigured } from '../../lib/config';
import { Alert, Button } from '../ui';
import { Brand } from '../Brand';
import { ThemeToggle } from '../ThemeToggle';
import type { AppRole } from '../../lib/database.types';

const NAV: Record<AppRole, Array<{ to: string; label: string }>> = {
  admin: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/courses', label: 'Courses' },
    { to: '/admin/exams', label: 'Exams' },
    { to: '/admin/reports', label: 'Reports' },
    { to: '/admin/audit', label: 'Audit logs' },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard' },
    { to: '/teacher/courses', label: 'Courses' },
  ],
  student: [
    { to: '/student', label: 'Dashboard' },
    { to: '/student/join', label: 'Join course' },
    { to: '/student/history', label: 'History' },
    { to: '/profile', label: 'Profile' },
  ],
};

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="app-brand" aria-label={appName}>
          <Brand variant="header" />
        </NavLink>
        {user ? (
          <nav className="app-nav" aria-label="Primary">
            {NAV[user.role].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === `/${user.role}`}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <div className="grow" />
        <ThemeToggle />
        {user ? (
          <div className="row">
            <span className="muted small">
              {user.profile.full_name || user.email} · <strong>{user.role}</strong>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
            >
              Sign out
            </Button>
          </div>
        ) : null}
      </header>
      {!isSupabaseConfigured ? (
        <div className="app-main">
          <Alert tone="warning" role="alert">
            Supabase is not configured. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
          </Alert>
        </div>
      ) : null}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
