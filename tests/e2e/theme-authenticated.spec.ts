import { expect, test, type Page } from '@playwright/test';

/**
 * Themed authenticated-surface checks.
 *
 * Branding reaches signed-in surfaces while appearance controls live in
 * Profile settings. The chosen theme must
 * persist across those pages. Gated on the same hosted credentials as
 * `authenticated.exam.spec.ts`; skipped when absent so the default suite stays
 * green offline.
 */
const configured = process.env.E2E_SUPABASE_CONFIGURED === 'true';
const email = process.env.E2E_STUDENT_EMAIL;
const password = process.env.E2E_STUDENT_PASSWORD;
const examId = process.env.E2E_EXAM_ID;

const STORAGE_KEY = 'exavyn.theme';

async function resolvedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

test.describe('themed authenticated surface', () => {
  test.skip(!configured || !email || !password, 'hosted E2E credentials not provided');

  async function signIn(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/student(\/|$)/, { timeout: 15_000 });
  }

  test('profile settings expose theme controls and the choice persists', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signIn(page);
    await expect(page.getByAltText('Exavyn')).toBeVisible();
    await page.goto('/profile');
    await expect(page.getByRole('group', { name: 'Color theme' })).toBeVisible();

    await page.getByRole('button', { name: 'Dark' }).click();
    expect(await resolvedTheme(page)).toBe('dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('dark');

    await page.reload();
    expect(await resolvedTheme(page)).toBe('dark');
    await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('the chosen theme carries into the exam instructions page', async ({ page }) => {
    test.skip(!examId, 'set E2E_EXAM_ID to run this check');
    await signIn(page);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.goto(`/student/exams/${examId}`);
    expect(await resolvedTheme(page)).toBe('dark');
    await expect(page.getByRole('heading', { name: /exam rules/i })).toBeVisible();
  });
});
