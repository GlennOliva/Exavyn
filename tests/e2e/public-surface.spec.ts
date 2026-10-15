import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Public-surface smoke tests. These run whether or not a Supabase project is
 * configured: the app must either render an explicit setup banner (unconfigured)
 * or omit it (configured) — never fabricate data either way.
 *
 * The full authenticated exam workflow (register -> enroll -> take -> two
 * violations -> immutable result) lives in `authenticated.exam.spec.ts` and
 * requires a running Supabase project plus isolated accounts.
 */

/** Detect browser-safe Supabase configuration the same way the app does. */
function appIsConfigured(): boolean {
  const placeholders = ['your-project-ref', 'your-anon'];
  const isReal = (value: string) => Boolean(value) && !placeholders.some((p) => value.includes(p));
  if (isReal(process.env.VITE_SUPABASE_URL ?? '')) return true;
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (!existsSync(file)) continue;
    const match = readFileSync(file, 'utf8').match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)$/m);
    if (match && isReal(match[1].trim().replace(/^["']|["']$/g, ''))) return true;
  }
  return false;
}

test('root redirects unauthenticated visitors to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

test('login page exposes recovery and registration links', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /create|student account/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /forgot/i })).toBeVisible();
});

test('registration page is reachable', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /student registration/i })).toBeVisible();
});

test('login page reflects the Supabase configuration state', async ({ page }) => {
  await page.goto('/login');
  const banner = page.getByRole('alert').filter({ hasText: /Supabase is not configured/i });
  if (appIsConfigured()) {
    // Real credentials present: no setup banner should be shown.
    await expect(banner).toHaveCount(0);
  } else {
    await expect(banner).toBeVisible();
  }
});
