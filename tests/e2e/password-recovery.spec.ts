import { expect, test } from '@playwright/test';

test('expired recovery links show a safe, actionable message without hash data', async ({
  page,
}) => {
  const expiredHash =
    '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

  await page.goto(`/update-password${expiredHash}`);

  await expect(page.getByRole('heading', { name: /reset link unavailable/i })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/expired or has already been used/i);
  await expect(page.getByRole('link', { name: /request a new reset email/i })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
  await expect(page.getByLabel('New password')).toHaveCount(0);

  await expect(page).toHaveURL(/\/update-password$/);
  expect(page.url()).not.toContain('access_denied');
  expect(page.url()).not.toContain('otp_expired');
});
