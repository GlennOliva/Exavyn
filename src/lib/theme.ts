/**
 * Theme primitives for Exavyn.
 *
 * Three user-selectable modes: `light`, `dark`, and `system`. `system` follows
 * the operating system preference and keeps following it live. The resolved
 * theme is written to `<html data-theme="light|dark">`, which drives the shared
 * CSS custom-property tokens in `index.css`.
 *
 * The initial theme is applied by a tiny inline script in `index.html` (before
 * React renders) so there is no flash of the wrong theme on load. This module
 * is the single source of truth for the storage key and the resolution rules;
 * keep the inline script's key in sync with `THEME_STORAGE_KEY`.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
/**
 * Public account screens always use the dark Cyber-Tribal surface. The
 * authenticated application keeps the user's saved light/dark/system choice.
 */
export type ThemeSurface = 'public' | 'app';

/** Must match the key used by the no-flash inline script in `index.html`. */
export const THEME_STORAGE_KEY = 'exavyn.theme';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Paths rendered with the fixed dark public surface, kept in sync with index.html. */
export const PUBLIC_AUTH_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/update-password',
] as const;

export function isPublicAuthPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (PUBLIC_AUTH_PATHS as readonly string[]).includes(normalized);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Current OS preference, or `light` when `matchMedia` is unavailable. */
export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

/** The saved preference, defaulting to `system` when nothing valid is stored. */
export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage may be unavailable (private mode); the in-memory state still works */
  }
}

/**
 * Write the resolved surface/theme to the document root. Public auth pages are
 * forced to the dark surface without touching the saved preference. Returns the
 * theme that was actually applied.
 */
export function applyTheme(mode: ThemeMode, surface: ThemeSurface = 'app'): ResolvedTheme {
  const resolved: ResolvedTheme = surface === 'public' ? 'dark' : resolveTheme(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-surface', surface);
    root.style.colorScheme = resolved;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#080B14' : '#F2F5F7';
  }
  return resolved;
}

/**
 * Subscribe to OS theme changes. Only meaningful while `system` is selected.
 * Returns an unsubscribe function; a no-op when `matchMedia` is unavailable.
 */
export function onSystemThemeChange(handler: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => handler(mql.matches ? 'dark' : 'light');
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }
  // Older browsers only expose addListener/removeListener.
  mql.addListener(listener);
  return () => mql.removeListener(listener);
}
