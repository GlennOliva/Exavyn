import { expect, test, type Page } from '@playwright/test';

/**
 * Feedback routing + unread loop through the real UI.
 *
 * The fixture enrolls the student in the teacher-owned course and provisions an
 * administrator. The student sends course-teacher feedback, the administrator
 * replies with a private note, and the student sees only the reply, with the
 * unread badge clearing after the explicit read action.
 */
const configured = process.env.E2E_SUPABASE_CONFIGURED === 'true';
const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const studentEmail = process.env.E2E_STUDENT_EMAIL;
const studentPassword = process.env.E2E_STUDENT_PASSWORD;

const subject = `E2E feedback ${Date.now()}`;
const message = 'Automated feedback routing check for the course teacher inbox.';
const response = 'Automated staff reply visible to the submitter.';
const privateNote = 'Automated private note that must never reach the submitter.';

async function signIn(page: Page, email: string, password: string, home: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(home, { timeout: 15_000 });
}

async function search(page: Page, value: string) {
  const input = page.getByLabel('Search feedback');
  await input.fill(value);
  await expect(page.locator('article').filter({ hasText: value }).first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe.serial('feedback routing and unread state', () => {
  test.skip(
    !configured ||
      !adminEmail ||
      !adminPassword ||
      !studentEmail ||
      !studentPassword,
    'feedback E2E credentials not provided',
  );

  test('student sends feedback to the owning course teacher', async ({ page }) => {
    await signIn(page, studentEmail!, studentPassword!, /\/student(\/|$)/);
    await page.goto('/feedback');
    await expect(page.getByRole('heading', { level: 1, name: 'Feedback' })).toBeVisible();

    const course = page.locator('#feedback-course');
    await expect.poll(async () => course.locator('option').count()).toBeGreaterThan(1);
    const courseId = await course.locator('option').nth(1).getAttribute('value');
    await course.selectOption(courseId!);

    const recipient = page.locator('#feedback-recipient');
    await expect(recipient).toBeEnabled();
    await recipient.selectOption('course_teacher');
    await page.locator('#feedback-subject').fill(subject);
    await page.locator('#feedback-message').fill(message);
    await page.getByRole('button', { name: 'Submit feedback' }).click();

    await expect(page.getByText(/feedback sent to the course teacher/i)).toBeVisible({
      timeout: 15_000,
    });
    await search(page, subject);
    const card = page.locator('article').filter({ hasText: subject }).first();
    await expect(card).toContainText('To: Course teacher');
    await expect(card).toContainText('No response yet');
  });

  test('administrator replies and keeps the private note out of the student view', async ({ page }) => {
    await signIn(page, adminEmail!, adminPassword!, /\/admin(\/|$)/);
    await page.goto('/feedback');
    await expect(page.getByRole('button', { name: 'Staff queue' })).toHaveClass(/primary/);
    await search(page, subject);

    const card = page.locator('article').filter({ hasText: subject }).first();
    await expect(card.locator('span.badge-warning').filter({ hasText: /^New$/ })).toBeVisible();
    await card.getByLabel('Status').selectOption('resolved');
    await card.getByLabel('Response visible to submitter').fill(response);
    await card.getByLabel('Private staff notes').fill(privateNote);
    const update = page.waitForResponse(
      (res) => res.url().includes('/rest/v1/rpc/update_feedback') && res.request().method() === 'POST',
    );
    await card.getByRole('button', { name: 'Save update' }).click();
    expect((await update).ok()).toBe(true);

    // Reload before asserting so the values must have come back from the server,
    // not from the local form state.
    await page.reload();
    await search(page, subject);
    const saved = page.locator('article').filter({ hasText: subject }).first();
    await expect(saved.getByLabel('Status')).toHaveValue('resolved');
    await expect(saved.getByLabel('Response visible to submitter')).toHaveValue(response);
    await expect(saved.getByLabel('Private staff notes')).toHaveValue(privateNote);
    await expect(saved.locator('span.badge-warning').filter({ hasText: /^New$/ })).toHaveCount(0);
  });

  test('student sees the reply, not the private note, and can clear the unread badge', async ({ page }) => {
    await signIn(page, studentEmail!, studentPassword!, /\/student(\/|$)/);
    await page.goto('/feedback');
    await search(page, subject);

    const card = page.locator('article').filter({ hasText: subject }).first();
    await expect(card.getByText('New response')).toBeVisible();
    await expect(card).toContainText(response);
    await expect(card).not.toContainText(privateNote);
    await expect(page.locator('#primary-sidebar a[href="/feedback"] .nav-badge')).toBeVisible();

    await card.getByRole('button', { name: 'Mark response as read' }).click();
    await expect(card.getByText('New response')).toHaveCount(0, { timeout: 15_000 });
    await expect(card).toContainText(response);
  });
});
