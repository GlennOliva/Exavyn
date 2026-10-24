import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { useFeedbackUnread } from '../../features/feedback/useFeedbackUnread';
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
    { to: '/profile', label: 'Profile & settings' },
    { to: '/feedback', label: 'Feedback' },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard' },
    { to: '/teacher/courses', label: 'Courses' },
    { to: '/profile', label: 'Profile & settings' },
    { to: '/feedback', label: 'Feedback' },
  ],
  student: [
    { to: '/student', label: 'Dashboard' },
    { to: '/student/join', label: 'Join course' },
    { to: '/student/history', label: 'History' },
    { to: '/profile', label: 'Profile & settings' },
    { to: '/feedback', label: 'Feedback' },
  ],
};

const MOBILE_QUERY = '(max-width: 820px)';
const COLLAPSED_KEY = 'exavyn.sidebar.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    /* storage may be unavailable; the in-memory state still works */
  }
}

/** Tracks the same breakpoint used by the sidebar CSS. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  return isMobile;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const feedbackUnread = useFeedbackUnread(location.pathname);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => persistCollapsed(collapsed), [collapsed]);

  const closeDrawer = useCallback((restoreFocus = true) => {
    setDrawerOpen(false);
    if (restoreFocus) window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      [...(drawer?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getClientRects().length > 0);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!drawer?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen, closeDrawer]);

  const handleNavClick = () => {
    if (!drawerOpen) return;
    setDrawerOpen(false);
    // The link that opened the drawer disappears with it. Move focus to the
    // page content instead of leaving it on an off-screen element.
    window.setTimeout(() => mainRef.current?.focus(), 0);
  };

  const navigationExpanded = isMobile ? drawerOpen : !collapsed;
  const toggleLabel = isMobile
    ? drawerOpen
      ? 'Close navigation'
      : 'Open navigation'
    : collapsed
      ? 'Show sidebar'
      : 'Hide sidebar';

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
      {isMobile && drawerOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => closeDrawer()}
        />
      ) : null}
      <aside
        ref={drawerRef}
        id="primary-sidebar"
        className={`app-sidebar ${drawerOpen ? 'drawer-open' : ''}`}
        aria-label="Application navigation"
        role={isMobile && drawerOpen ? 'dialog' : undefined}
        aria-modal={isMobile && drawerOpen ? true : undefined}
        inert={isMobile && !drawerOpen ? true : undefined}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm sidebar-close"
          aria-label="Close navigation"
          onClick={() => closeDrawer()}
        >
          <CloseIcon />
        </button>
        <NavLink to="/" className="app-brand sidebar-brand" aria-label={appName} onClick={handleNavClick}>
          <Brand variant="header" showTagline={false} />
        </NavLink>
        {user ? (
          <>
            <div className="sidebar-role">{user.role}</div>
            <nav className="app-nav" aria-label="Primary">
              {NAV[user.role].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === `/${user.role}`}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                  title={!isMobile && collapsed ? item.label : undefined}
                  onClick={handleNavClick}
                >
                  <span className="nav-marker" aria-hidden="true">•</span>
                  <span className="nav-label">{item.label}</span>
                  {item.to === '/feedback' && feedbackUnread > 0 ? (
                    <span
                      className="nav-badge"
                      aria-label={`${feedbackUnread} unread feedback ${feedbackUnread === 1 ? 'item' : 'items'}`}
                    >
                      {feedbackUnread > 9 ? '9+' : feedbackUnread}
                    </span>
                  ) : null}
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
      <div className="app-frame" inert={isMobile && drawerOpen ? true : undefined}>
        <header className="app-header">
          <button
            ref={menuButtonRef}
            type="button"
            className="btn btn-outline menu-toggle"
            aria-expanded={navigationExpanded}
            aria-controls="primary-sidebar"
            aria-label={toggleLabel}
            onClick={() => {
              if (isMobile) {
                if (drawerOpen) closeDrawer();
                else setDrawerOpen(true);
              } else {
                setCollapsed((value) => !value);
              }
            }}
          >
            <MenuIcon />
          </button>
          <div className="grow" />
          {user ? <span className="muted small workspace-label"><strong>{user.role}</strong> workspace</span> : null}
        </header>
        {!isSupabaseConfigured ? (
          <div className="app-main">
            <Alert tone="warning" role="alert">
              Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
            </Alert>
          </div>
        ) : null}
        <main className="app-main" ref={mainRef} tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
