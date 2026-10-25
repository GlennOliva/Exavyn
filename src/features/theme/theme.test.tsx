import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Brand } from '../../components/Brand';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  isPublicAuthPath,
  readStoredTheme,
  resolveTheme,
} from '../../lib/theme';

type ChangeListener = (event: { matches: boolean }) => void;
let listeners: ChangeListener[] = [];
let prefersDark = false;

function installMatchMedia() {
  window.matchMedia = ((query: string) => {
    const mql = {
      get matches() {
        return query.includes('dark') ? prefersDark : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: ChangeListener) => listeners.push(cb),
      removeEventListener: (_type: string, cb: ChangeListener) => {
        listeners = listeners.filter((l) => l !== cb);
      },
      addListener: (cb: ChangeListener) => listeners.push(cb),
      removeListener: (cb: ChangeListener) => {
        listeners = listeners.filter((l) => l !== cb);
      },
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as unknown as typeof window.matchMedia;
}

function setSystemDark(value: boolean) {
  prefersDark = value;
  listeners.forEach((cb) => cb({ matches: value }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  listeners = [];
  prefersDark = false;
  installMatchMedia();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-surface');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-surface');
  document.documentElement.style.colorScheme = '';
});

describe('theme resolution and persistence', () => {
  it('defaults to system, following the OS preference', () => {
    expect(readStoredTheme()).toBe('system');
    prefersDark = true;
    expect(resolveTheme('system')).toBe('dark');
    prefersDark = false;
    expect(resolveTheme('system')).toBe('light');
  });

  it('reads a stored preference and falls back for invalid values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    expect(readStoredTheme()).toBe('system');
  });

  it('applies the resolved theme to the document root and persists it', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await act(async () => result.current.setMode('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('keeps following the system theme while System is selected', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.mode).toBe('system');

    await act(async () => setSystemDark(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await act(async () => setSystemDark(false));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('stops following the system once an explicit theme is chosen', async () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    await act(async () => result.current.setMode('light'));

    await act(async () => setSystemDark(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('recognises only the public account paths', () => {
    expect(isPublicAuthPath('/login')).toBe(true);
    expect(isPublicAuthPath('/register/')).toBe(true);
    expect(isPublicAuthPath('/forgot-password')).toBe(true);
    expect(isPublicAuthPath('/update-password')).toBe(true);
    expect(isPublicAuthPath('/student')).toBe(false);
    expect(isPublicAuthPath('/login-help')).toBe(false);
  });

  it('forces the public auth surface dark without overwriting the saved preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.history.replaceState({}, '', '/login');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });

    expect(result.current.surface).toBe('public');
    expect(document.documentElement.getAttribute('data-surface')).toBe('public');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores the saved preference when leaving the public surface', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });

    await act(async () => result.current.setSurface('public'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await act(async () => result.current.setSurface('app'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-surface')).toBe('app');
  });

  it('applies the public surface directly without persisting a theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(applyTheme('light', 'public')).toBe('dark');
    expect(document.documentElement.getAttribute('data-surface')).toBe('public');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('exposes all three options with the current one pressed', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    for (const label of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches theme on click and persists the choice', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('is keyboard operable', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const light = screen.getByRole('button', { name: 'Light' });
    light.focus();
    expect(light).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('Brand', () => {
  it('renders the logo with accessible alt text and no slogan', () => {
    render(<Brand />);
    expect(screen.getByAltText('Exavyn')).toBeInTheDocument();
    expect(screen.queryByText('Focused exams. Clear results.')).toBeNull();
  });
});
