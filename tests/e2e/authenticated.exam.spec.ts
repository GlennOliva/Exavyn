import { expect, test, type Page } from '@playwright/test';

/**
 * Authenticated exam interface checks.
 *
 * These require a live Supabase project configured in `.env.local`
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) plus dedicated student
 * credentials for an already-approved enrollment with a published exam:
 *
 *   E2E_SUPABASE_CONFIGURED=true
 *   E2E_STUDENT_EMAIL=student-e2e@exam.test
 *   E2E_STUDENT_PASSWORD=...
 *   E2E_EXAM_ID=<published exam uuid>        (optional; otherwise first card)
 *   E2E_RESULT_EXPECT_IMMEDIATE=true         (optional)
 *
 * Without those, every test here is skipped so the default `npm run test:e2e`
 * stays green offline. See docs/HOSTED_VERIFICATION.md.
 */
const configured = process.env.E2E_SUPABASE_CONFIGURED === 'true';
const email = process.env.E2E_STUDENT_EMAIL;
const password = process.env.E2E_STUDENT_PASSWORD;
const examId = process.env.E2E_EXAM_ID;

test.describe('authenticated exam interface', () => {
  test.skip(!configured || !email || !password, 'hosted E2E credentials not provided');
  // Fullscreen + visibility semantics are only dependable in Chromium here.
  test.skip(({ browserName }) => browserName !== 'chromium', 'fullscreen exam mode is Chromium-only in CI');

  async function signIn(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait for the post-login redirect, not just any heading: the login page
    // itself renders an <h1>, so a heading assertion returns before auth (and
    // session persistence) completes.
    await expect(page).toHaveURL(/\/student(\/|$)/, { timeout: 15_000 });
  }

  test('student can sign in and see the dashboard', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/student$/);
  });

  test('exam instructions expose the monitoring policy without leaking answers', async ({ page }) => {
    await signIn(page);
    const path = examId ? `/student/exams/${examId}` : null;
    test.skip(!path, 'set E2E_EXAM_ID to run the exam-instructions checks');
    await page.goto(path!);

    await expect(page.getByRole('heading', { name: /exam rules/i })).toBeVisible();
    await expect(page.getByText(/two-violation rule/i)).toBeVisible();
    await expect(page.getByText(/browser monitoring limitations/i)).toBeVisible();
    await expect(page.getByLabel(/I have read and accept/i)).toBeVisible();

    // No correctness material may reach the browser.
    const html = (await page.content()).toLowerCase();
    for (const forbidden of ['correct_option_id', 'correct_index', 'answer_key']) {
      expect(html, `page must not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test('starting, answering, and a departure produce a warning; a second departure finalizes', async ({
    page,
  }) => {
    await signIn(page);
    test.skip(!examId, 'set E2E_EXAM_ID to run the full attempt flow');
    await page.goto(`/student/exams/${examId}`);

    await page.getByLabel(/I have read and accept/i).check();
    await page.getByRole('button', { name: /enter fullscreen & start|resume exam/i }).click();

    // If the environment refuses fullscreen, skip rather than report a false failure.
    const started = page.getByRole('button', { name: /submit exam/i });
    const refused = page.getByRole('alert').filter({ hasText: /fullscreen|does not support/i });
    await Promise.race([
      started.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined),
      refused.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined),
    ]);
    test.skip(!(await started.isVisible().catch(() => false)), 'fullscreen exam mode unavailable in this browser');

    // Answer the first question and wait for the server-save acknowledgement.
    await page.locator('.choice input[type="radio"]').first().check();
    await expect(page.getByText(/saved to server|saved/i).first()).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 15_000 });

    // A real departure: leaving fullscreen fires a genuine fullscreenchange,
    // which the monitor records as a violation. (Synthetic events cannot change
    // real document state, so they never register.)
    await page.evaluate(() => document.exitFullscreen());

    const warning = page.getByRole('alertdialog').filter({ hasText: /warning 1 of 2/i });
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(warning).toContainText(/automatically submit/i);

    // Acknowledging re-enters fullscreen; the tracker only re-arms once the
    // document is visible, focused and fullscreen again.
    await page.getByRole('button', { name: /I understand/i }).click();
    await page.bringToFront();
    await page.waitForFunction(
      () => document.hasFocus() && Boolean(document.fullscreenElement),
      null,
      { timeout: 15_000 },
    );
    // Nudge the recovery branch, then clear DEPARTURE_COALESCE_MS (1200ms) so the
    // next departure opens a new episode rather than merging into this one.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1600);

    // Departure #2 — a real fullscreen exit fires a genuine fullscreenchange and
    // finalizes the attempt from server-saved answers.
    await page.evaluate(() => document.exitFullscreen());
    await expect(page).toHaveURL(/\/student\/attempts\/.+\/result$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
