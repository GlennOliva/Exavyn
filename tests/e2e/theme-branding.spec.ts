import { expect, test, type Page } from '@playwright/test';

/**
 * Exavyn branding + light/dark theme checks. These run on the public pages and
 * need no backend: they assert the title/logo/tagline, the theme control, theme
 * persistence across reload, live System behaviour, and that the layout works
 * on desktop and mobile viewports. No Supabase credentials are required.
 */

const STORAGE_KEY = 'exavyn.theme';

async function resolvedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

test.describe('Exavyn branding and themes', () => {
  test('browser title and logo reflect Exavyn', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Exavyn/);
    await expect(page.getByAltText('Exavyn')).toBeVisible();
    await expect(page.getByText('Focused exams. Clear results.')).toBeVisible();

    const expected = process.env.VITE_APP_NAME ?? 'Exavyn';
    await expect(page).toHaveTitle(new RegExp(expected));
  });

  test('theme control offers Light, Dark, and System and defaults to the OS preference', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');

    // No explicit light/dark choice stored -> System, resolved to the OS preference.
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(stored === null || stored === 'system').toBe(true);
    await expect(page.getByRole('group', { name: 'Color theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await resolvedTheme(page)).toBe('dark');
  });

  test('an explicit choice is applied and persists across reload', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Dark' }).click();
    expect(await resolvedTheme(page)).toBe('dark');

    await page.reload();
    expect(await resolvedTheme(page)).toBe('dark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Applied before React: the root attribute is already dark immediately.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      'dark',
    );
  });

  test('System follows live operating-system changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await page.getByRole('button', { name: 'System' }).click();
    expect(await resolvedTheme(page)).toBe('light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => resolvedTheme(page)).toBe('dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => resolvedTheme(page)).toBe('light');
  });

  test('the theme preference survives client-side navigation', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('link', { name: /create a student account/i }).click();
    await expect(page).toHaveURL(/\/register$/);
    expect(await resolvedTheme(page)).toBe('dark');
  });

  test('theme toggle is keyboard operable', async ({ page }) => {
    await page.goto('/login');
    const light = page.getByRole('button', { name: 'Light' });
    await light.focus();
    await expect(light).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await resolvedTheme(page)).toBe('light');
  });
});

test.describe('Exavyn mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('branding and theme control remain usable in both themes', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByAltText('Exavyn')).toBeVisible();

    const toggle = page.getByRole('group', { name: 'Color theme' });
    await expect(toggle).toBeVisible();

    await page.getByRole('button', { name: 'Dark' }).click();
    expect(await resolvedTheme(page)).toBe('dark');
    // The wordmark stays inside the viewport (no horizontal overflow).
    const box = await page.getByAltText('Exavyn').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    await page.getByRole('button', { name: 'Light' }).click();
    expect(await resolvedTheme(page)).toBe('light');
    await expect(toggle).toBeVisible();
  });
});
