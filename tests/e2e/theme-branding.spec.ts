import { expect, test, type Page } from '@playwright/test';

/**
 * Public branding and surface checks. Public account screens always use the
 * dark Cyber-Tribal surface, expose no appearance controls, and must never
 * overwrite a signed-in user's saved theme preference. No backend is required.
 */

const STORAGE_KEY = 'exavyn.theme';
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/update-password'];

async function surface(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-surface'));
}

async function resolvedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

test.describe('Exavyn public branding', () => {
  test('browser title and logo reflect Exavyn without the old slogan', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Exavyn/);
    await expect(page.getByAltText('Exavyn')).toBeVisible();
    await expect(page.getByText('Focused exams. Clear results.')).toHaveCount(0);

    const expected = process.env.VITE_APP_NAME ?? 'Exavyn';
    await expect(page).toHaveTitle(new RegExp(expected));
  });

  test('all public account pages are fixed-dark with no appearance controls', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    for (const path of PUBLIC_PATHS) {
      await page.goto(path);
      expect(await surface(page)).toBe('public');
      expect(await resolvedTheme(page)).toBe('dark');
      await expect(page.getByRole('group', { name: 'Color theme' })).toHaveCount(0);
    }
  });

  test('a saved light preference is not applied, changed, or persisted from login', async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [STORAGE_KEY, 'light'],
    );
    await page.goto('/login');

    expect(await surface(page)).toBe('public');
    expect(await resolvedTheme(page)).toBe('dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');

    await page.getByRole('link', { name: /create a student account/i }).click();
    await expect(page).toHaveURL(/\/register$/);
    expect(await surface(page)).toBe('public');
    expect(await resolvedTheme(page)).toBe('dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');
  });

  test('the public surface is applied before React paints', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('exavyn.theme', 'light'));
    await page.goto('/login');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-surface'))).toBe(
      'public',
    );
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
  });

  test('the public story is present on desktop and removed on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await expect(page.getByText('Built into every session.')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Built into every session.')).toBeHidden();
  });
});

test.describe('Exavyn public mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('branding and the sign-in form fit without horizontal overflow', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByAltText('Exavyn')).toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Color theme' })).toHaveCount(0);

    const box = await page.getByAltText('Exavyn').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
