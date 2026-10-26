import { expect, test } from '@playwright/test';

/**
 * Browser proof for the teacher enrollment search. The hosted suite covers the
 * exhaustive RPC/authorization matrix; this spec verifies the UI path, debounce,
 * empty state, filters, and that PostgREST parser text never reaches the page.
 */
const teacherEmail = process.env.E2E_TEACHER_EMAIL ?? '';
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? '';
const courseId = process.env.E2E_COURSE_ID ?? '';
const studentEmail = process.env.E2E_STUDENT_EMAIL ?? '';

test.skip(
  !teacherEmail || !teacherPassword || !courseId || !studentEmail,
  'Run `npm run e2e:fixture` to provision teacher search credentials.',
);

test('teacher searches enrollments by name/email and handles literal wildcards', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(teacherEmail);
  await page.getByLabel('Password').fill(teacherPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/teacher(\/|$)/);

  await page.goto(`/teacher/courses/${courseId}`);
  await expect(page.getByText('1 record(s)')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('cell', { name: /e2e student/i })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search enrollments' });

  await search.fill('zzz-no-such-student');
  await expect(page.getByText('No matching enrollments')).toBeVisible();
  await expect(page.getByText(/failed to parse logic tree/i)).toHaveCount(0);

  await search.fill('E2E STUDENT');
  await expect(page.getByRole('cell', { name: /e2e student/i })).toBeVisible();

  await search.fill(studentEmail.toUpperCase());
  await expect(page.getByRole('cell', { name: /e2e student/i })).toBeVisible();

  await search.fill('%');
  await expect(page.getByText('No matching enrollments')).toBeVisible();
  await expect(page.getByText('0 record(s)')).toBeVisible();

  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.getByRole('cell', { name: /e2e student/i })).toBeVisible();

  await page.getByLabel('Filter enrollment status').selectOption('pending');
  await expect(page.getByText('No matching enrollments')).toBeVisible();
  await page.getByLabel('Filter enrollment status').selectOption('approved');
  await expect(page.getByRole('cell', { name: /e2e student/i })).toBeVisible();
  await expect(page.getByText('1 record(s)')).toBeVisible();
});
