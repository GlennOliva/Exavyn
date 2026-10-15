import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { PageSpinner } from './ui';
import type { AppRole } from '../lib/database.types';

export function RequireAuth() {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

const HOME_BY_ROLE: Record<AppRole, string> = {
  admin: '/admin',
  teacher: '/teacher',
  student: '/student',
};

export function RequireRole({ roles }: { roles: AppRole[] }) {
  const { loading, user } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    // Client guards are a convenience; the database enforces authorization.
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  }
  return <Outlet />;
}

export function RoleHomeRedirect() {
  const { loading, user } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
}
