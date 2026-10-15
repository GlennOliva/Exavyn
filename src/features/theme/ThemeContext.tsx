import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  onSystemThemeChange,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '../../lib/theme';

interface ThemeContextValue {
  /** The saved preference: light, dark, or system. */
  mode: ThemeMode;
  /** The theme actually applied (system resolved to light/dark). */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredTheme());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredTheme()));

  // Apply + persist whenever the preference changes.
  useEffect(() => {
    setResolved(applyTheme(mode));
    storeTheme(mode);
  }, [mode]);

  // While `system` is selected, follow live OS changes.
  useEffect(() => {
    if (mode !== 'system') return;
    return onSystemThemeChange(() => setResolved(applyTheme('system')));
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
