import { expect, test } from '@playwright/test';

/**
 * Registration page behaviour.
 *
 * These are deterministic and need no hosted credentials: the signup endpoint
 * is intercepted, so no email is sent and no real user is created.
 *
 *   1. A rapid double submit must send exactly ONE request.
 *   2. A 429 email-send-limit response must surface a clear, student-friendly
 *      message (never the raw "email rate limit exceeded").
 */
const SUBMIT = /create student account/i;

test.describe('registration page', () => {
  test('double submit sends exactly one signup request', async ({ page }) => {
    const counter = { value: 0 };
    await page.route('**/auth/v1/signup', async (route) => {
      counter.value += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto('/register');
    await page.getByLabel('Full name').fill('Race Condition');
    await page.getByLabel('Email').fill('race@exam.test');
    await page.getByLabel('Password', { exact: true }).fill('Passw0rd!123');
    await page.getByLabel('Confirm password').fill('Passw0rd!123');

    // Dispatch two clicks synchronously (before React re-renders) to exercise
    // the synchronous in-flight guard, not just the `disabled` attribute.
    await page.getByRole('button', { name: SUBMIT }).evaluate((el) => {
      el.click();
      el.click();
    });

    await expect.poll(() => counter.value, { timeout: 5000 }).toBe(1);
    await page.waitForTimeout(300);
    expect(counter.value).toBe(1);
  });

  test('shows a clear message when the email send limit is hit', async ({ page }) => {
    await page.route('**/auth/v1/signup', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'email rate limit exceeded',
        }),
      });
    });

    await page.goto('/register');
    await page.getByLabel('Full name').fill('Rate Limited');
    await page.getByLabel('Email').fill('limited@exam.test');
    await page.getByLabel('Password', { exact: true }).fill('Passw0rd!123');
    await page.getByLabel('Confirm password').fill('Passw0rd!123');
    await page.getByRole('button', { name: SUBMIT }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/too many verification emails/i);
    await expect(alert).not.toContainText(/email rate limit exceeded/i);
  });
});
