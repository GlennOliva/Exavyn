import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { appName, isSupabaseConfigured } from '../../lib/config';
import { Alert, Button } from '../ui';
import { Brand } from '../Brand';
import type { AppRole } from '../../lib/database.types';

const NAV: Record<AppRole, Array<{ to: string; label: string }>> = {
  admin: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/courses', label: 'Courses' },
    { to: '/admin/exams', label: 'Exams' },
    { to: '/admin/reports', label: 'Reports' },
    { to: '/admin/audit', label: 'Audit logs' },
    { to: '/feedback', label: 'Feedback' },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard' },
    { to: '/teacher/courses', label: 'Courses' },
    { to: '/feedback', label: 'Feedback' },
  ],
  student: [
    { to: '/student', label: 'Dashboard' },
    { to: '/student/join', label: 'Join course' },
    { to: '/student/history', label: 'History' },
    { to: '/profile', label: 'Profile' },
    { to: '/feedback', label: 'Feedback' },
  ],
};

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const focusable = () => [...(drawer?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const signOutButton = (
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
  );

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {drawerOpen ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} /> : null}
      <aside ref={drawerRef} id="primary-sidebar" className={`app-sidebar ${drawerOpen ? 'drawer-open' : ''}`} aria-label="Application navigation">
        <button className="btn btn-ghost btn-sm sidebar-close" onClick={() => { setDrawerOpen(false); menuButtonRef.current?.focus(); }}>Close navigation</button>
        <NavLink to="/" className="app-brand sidebar-brand" aria-label={appName}>
          <Brand variant="header" />
        </NavLink>
        {user ? (
          <>
            <div className="sidebar-role">{user.role}</div>
            <nav className="app-nav" aria-label="Primary">
              {NAV[user.role].map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === `/${user.role}`} className={({ isActive }) => (isActive ? 'active' : '')} title={collapsed ? item.label : undefined}>
                  <span className="nav-marker" aria-hidden="true">•</span><span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="sidebar-account">
              <span className="small sidebar-user">{user.profile.full_name || user.email}</span>
              {signOutButton}
            </div>
          </>
        ) : null}
      </aside>
      <div className="app-frame">
        <header className="app-header">
          <button ref={menuButtonRef} className="btn btn-outline btn-sm mobile-menu-button" aria-expanded={drawerOpen} aria-controls="primary-sidebar" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>Menu</button>
          <Button className="desktop-collapse-button" size="sm" variant="ghost" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? 'Expand' : 'Collapse'}</Button>
          <div className="grow" />
          {user ? <span className="muted small"><strong>{user.role}</strong> workspace</span> : null}
        </header>
        {!isSupabaseConfigured ? (
          <div className="app-main">
            <Alert tone="warning" role="alert">
              Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
            </Alert>
          </div>
        ) : null}
        <main className="app-main"><Outlet /></main>
      </div>
    </div>
  );
}
