import { expect, test, type Page } from '@playwright/test';

/**
 * Administrator sign-in and route check.
 *
 * Gated on dedicated admin credentials so the default `npm run test:e2e` stays
 * green offline. `scripts/provision-admin.mjs --browser` sets these variables
 * in-process (the password is never written to disk):
 *
 *   E2E_SUPABASE_CONFIGURED=true
 *   E2E_ADMIN_EMAIL=admin@gmail.com
 *   E2E_ADMIN_PASSWORD=...
 */
const configured = process.env.E2E_SUPABASE_CONFIGURED === 'true';
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test.describe('administrator access', () => {
  test.skip(!configured || !email || !password, 'admin E2E credentials not provided');

  async function signIn(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
  }

  test('administrator signs in and is routed to /admin', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: /administrator|admin/i })).toBeVisible();
  });

  test('administrator can open the user management page', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 15_000 });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
