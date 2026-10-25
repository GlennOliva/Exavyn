import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  isPublicAuthPath,
  onSystemThemeChange,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  type ResolvedTheme,
  type ThemeMode,
  type ThemeSurface,
} from '../../lib/theme';

interface ThemeContextValue {
  /** The saved preference: light, dark, or system. */
  mode: ThemeMode;
  /** The theme actually applied (system resolved to light/dark). */
  resolved: ResolvedTheme;
  /** Public auth screens are fixed-dark; authenticated screens honour `mode`. */
  surface: ThemeSurface;
  setMode: (mode: ThemeMode) => void;
  setSurface: (surface: ThemeSurface) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredTheme());
  const [surface, setSurfaceState] = useState<ThemeSurface>(() =>
    typeof window !== 'undefined' && isPublicAuthPath(window.location.pathname) ? 'public' : 'app',
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window !== 'undefined' && isPublicAuthPath(window.location.pathname)
      ? 'dark'
      : resolveTheme(readStoredTheme()),
  );

  // Apply whenever the preference or surface changes. Public auth screens never
  // persist a preference, so visiting the login page cannot overwrite a signed-in
  // user's saved choice.
  useLayoutEffect(() => {
    setResolved(applyTheme(mode, surface));
    if (surface === 'app') storeTheme(mode);
  }, [mode, surface]);

  // While `system` is selected, follow live OS changes on authenticated pages.
  useEffect(() => {
    if (mode !== 'system' || surface === 'public') return;
    return onSystemThemeChange(() => setResolved(applyTheme('system', 'app')));
  }, [mode, surface]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const setSurface = useCallback((next: ThemeSurface) => setSurfaceState(next), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, surface, setMode, setSurface }),
    [mode, resolved, surface, setMode, setSurface],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
