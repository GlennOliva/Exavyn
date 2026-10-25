import { useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { isPublicAuthPath } from '../../lib/theme';
import { useTheme } from './ThemeContext';

/**
 * Keeps the document surface in sync with the current route. The layout effect
 * runs before paint, so moving between public auth screens and the signed-in
 * application never flashes the other surface.
 */
export function ThemeSurface() {
  const { pathname } = useLocation();
  const { setSurface } = useTheme();
  const surface = isPublicAuthPath(pathname) ? 'public' : 'app';

  useLayoutEffect(() => {
    setSurface(surface);
  }, [surface, setSurface]);

  return <Outlet />;
}
