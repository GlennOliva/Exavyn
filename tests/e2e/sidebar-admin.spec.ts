import { expect, test, type Page } from '@playwright/test';

/**
 * Administrator directory + navigation shell.
 *
 * Gated on the dedicated fixture created by `npm run e2e:fixture`, which now
 * provisions an isolated administrator alongside the student/teacher fixture.
 */
const configured = process.env.E2E_SUPABASE_CONFIGURED === 'true';
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const studentEmail = process.env.E2E_STUDENT_EMAIL;
const studentPassword = process.env.E2E_STUDENT_PASSWORD;

async function signIn(page: Page, email: string, password: string, home: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(home, { timeout: 15_000 });
}

test.describe('administrator directory and sidebar', () => {
  test.skip(
    !configured || !adminEmail || !adminPassword,
    'admin E2E credentials not provided',
  );

  test('user management loads the role embed without PGRST201', async ({ page }) => {
    await signIn(page, adminEmail!, adminPassword!, /\/admin(\/|$)/);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: /user management/i })).toBeVisible();
    await expect(page.getByText(/could not embed/i)).toHaveCount(0);

    const search = page.getByRole('searchbox', { name: 'Search users' });
    await search.fill(adminEmail!);
    const row = page.getByRole('row').filter({ hasText: adminEmail! });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole('combobox', { name: `Role for ${adminEmail}` })).toHaveValue('admin');
    await expect(page.locator('.alert-danger')).toHaveCount(0);
  });

  test('hamburger hides and restores the desktop sidebar without overflow', async ({ page }) => {
    await signIn(page, adminEmail!, adminPassword!, /\/admin(\/|$)/);
    const toggle = page.getByRole('button', { name: 'Hide sidebar' });
    const sidebar = page.locator('#primary-sidebar');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeVisible();

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // The desktop preference survives a reload.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
    await expect(sidebar).toBeHidden();

    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible();
    // The marketing slogan belongs to public/auth pages only.
    await expect(page.getByText('Focused exams. Clear results.')).toHaveCount(0);

    // Staff can reach the shared appearance settings from the sidebar.
    await sidebar.getByRole('link', { name: 'Profile & settings' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  });

  test('mobile drawer traps focus, closes with Escape/backdrop, and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, adminEmail!, adminPassword!, /\/admin(\/|$)/);
    const menu = page.getByRole('button', { name: 'Open navigation' });
    const sidebar = page.locator('#primary-sidebar');
    const drawerClose = sidebar.getByRole('button', { name: 'Close navigation' });
    await expect(sidebar).toBeHidden();

    await menu.click();
    await expect(page.getByRole('button', { name: 'Close navigation' }).first()).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(drawerClose).toBeFocused();
    expect(await page.locator('.app-frame').evaluate((el) => el.hasAttribute('inert'))).toBe(true);

    // The tab ring stays inside the dialog.
    await page.keyboard.press('Shift+Tab');
    await expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawerClose).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
    await expect(menu).toBeFocused();
    expect(await page.locator('.app-frame').evaluate((el) => el.hasAttribute('inert'))).toBe(false);

    await menu.click();
    await expect(sidebar).toBeVisible();
    await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 40 } });
    await expect(sidebar).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await sidebar.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('main')).toBeFocused();
  });
});

test.describe('student navigation shell', () => {
  test.skip(
    !configured || !studentEmail || !studentPassword,
    'student E2E credentials not provided',
  );

  test('student nav order and branding, with no header theme selector', async ({ page }) => {
    await signIn(page, studentEmail!, studentPassword!, /\/student(\/|$)/);
    const labels = await page.locator('#primary-sidebar .nav-label').allTextContents();
    expect(labels).toEqual([
      'Dashboard',
      'Join course',
      'History',
      'Profile & settings',
      'Feedback',
    ]);
    await expect(page.getByText('Focused exams. Clear results.')).toHaveCount(0);
    await expect(
      page.locator('.app-header').getByRole('group', { name: 'Color theme' }),
    ).toHaveCount(0);

    await page.getByRole('link', { name: 'Profile & settings' }).click();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Color theme' })).toBeVisible();
  });
});
