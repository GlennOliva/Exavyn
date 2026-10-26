import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

/**
 * Live browser proof for the teacher exam-results search. The hosted suite owns
 * the exhaustive RPC/authorization matrix; this spec provisions an isolated
 * draft exam + attempts under the existing E2E teacher/course fixture, checks
 * the UI states and stale-response behavior, and removes every mutable artifact.
 */
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const teacherEmail = process.env.E2E_TEACHER_EMAIL ?? '';
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? '';
const courseId = process.env.E2E_COURSE_ID ?? '';

test.skip(
  !supabaseUrl || !serviceKey || !anonKey || !teacherEmail || !teacherPassword || !courseId,
  'Run `npm run e2e:fixture` to provision the E2E teacher/course fixture.',
);

test('teacher searches results by name/email with literal wildcards', async ({ page }) => {
  test.setTimeout(60_000);

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = randomBytes(4).toString('hex');
  const password = `E2eResults-${run}-Aa1`;
  const studentEmails = [
    `e2e-results-alpha-${run}@exam.test`,
    `e2e-results-bravo-${run}@exam.test`,
  ];
  const userIds: string[] = [];
  let examId: string | null = null;
  let versionId: string | null = null;

  try {
    const { data: teacher, error: teacherError } = await service
      .from('profiles')
      .select('id')
      .eq('email', teacherEmail)
      .single();
    if (teacherError || !teacher) {
      throw new Error(`E2E teacher profile not found: ${teacherError?.message ?? 'missing'}`);
    }

    const start = Date.now();
    const opensAt = new Date(start - 60 * 60 * 1000).toISOString();
    const closesAt = new Date(start + 24 * 60 * 60 * 1000).toISOString();

    const { data: exam, error: examError } = await service
      .from('exams')
      .insert({
        course_id: courseId,
        owner_id: teacher.id,
        title: `E2E results search ${run}`,
        duration_minutes: 60,
        opens_at: opensAt,
        closes_at: closesAt,
        state: 'draft',
      })
      .select('id')
      .single();
    if (examError || !exam) throw new Error(`insert exam: ${examError?.message ?? 'missing'}`);
    examId = exam.id;

    const { data: version, error: versionError } = await service
      .from('exam_versions')
      .insert({
        exam_id: examId,
        version_no: 1,
        title: `E2E results search ${run}`,
        duration_minutes: 60,
        opens_at: opensAt,
        closes_at: closesAt,
        result_release: 'immediate',
        frozen: false,
        published_by: teacher.id,
      })
      .select('id')
      .single();
    if (versionError || !version) {
      throw new Error(`insert version: ${versionError?.message ?? 'missing'}`);
    }
    versionId = version.id;

    const definitions = [
      { name: `E2E Results Alpha ${run}`, email: studentEmails[0], state: 'submitted' },
      { name: `E2E Results Bravo 100%_Test ${run}`, email: studentEmails[1], state: 'in_progress' },
    ] as const;

    const attempts = [];
    for (const [index, definition] of definitions.entries()) {
      const { data: user, error: userError } = await service.auth.admin.createUser({
        email: definition.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: definition.name },
      });
      if (userError || !user.user) {
        throw new Error(`create student ${index}: ${userError?.message ?? 'missing'}`);
      }
      userIds.push(user.user.id);
      const submitted = definition.state === 'submitted';
      attempts.push({
        exam_id: examId,
        exam_version_id: versionId,
        student_id: user.user.id,
        attempt_no: 1,
        started_at: new Date(start - 60_000 + index * 1000).toISOString(),
        deadline_at: new Date(start + 60 * 60 * 1000).toISOString(),
        state: definition.state,
        submitted_at: submitted ? new Date(start - 30_000).toISOString() : null,
        submission_reason: submitted ? 'manual' : null,
        earned_points: submitted ? 8 : null,
        max_points: submitted ? 10 : null,
        percentage: submitted ? 80 : null,
        answered_count: submitted ? 10 : null,
        correct_count: submitted ? 8 : null,
      });
    }

    const { error: attemptsError } = await service.from('exam_attempts').insert(attempts);
    if (attemptsError) throw new Error(`insert attempts: ${attemptsError.message}`);

    let delayAlpha = false;
    await page.route('**/rest/v1/rpc/get_exam_attempts_page', async (route) => {
      if (delayAlpha) {
        delayAlpha = false;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      await route.continue();
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(teacherEmail);
    await page.getByLabel('Password').fill(teacherPassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/teacher(\/|$)/);

    await page.goto(`/teacher/exams/${examId}/results`);
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search results' });
    await search.fill('zzz-no-such-student');
    await expect(page.getByText('No matching results')).toBeVisible();
    await expect(search).toBeVisible();
    await expect(page.getByText(/failed to parse logic tree/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();

    delayAlpha = true;
    await search.fill('E2E RESULTS ALPHA');
    await page.waitForRequest((request) => {
      if (!request.url().includes('/rest/v1/rpc/get_exam_attempts_page')) return false;
      return request.postDataJSON()?.p_search === 'E2E RESULTS ALPHA';
    });
    await search.fill('E2E RESULTS BRAVO');
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();
    await page.waitForTimeout(1_100);
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toHaveCount(0);

    await search.fill('%');
    await expect(page.getByRole('cell', { name: /100%_Test/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toHaveCount(0);

    await search.fill('');
    await page.getByLabel('Filter attempt state').selectOption('in_progress');
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toHaveCount(0);

    await page.getByLabel('Filter attempt state').selectOption('submitted');
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toHaveCount(0);

    await page.getByLabel('Filter attempt state').selectOption('all');
    await expect(page.getByRole('cell', { name: /E2E Results Alpha/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Results Bravo/ })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`exam-${examId}-results.csv`);
  } finally {
    if (examId) {
      await service.from('exam_attempts').delete().eq('exam_id', examId);
    }
    if (versionId) {
      await service.from('exam_versions').delete().eq('id', versionId);
    }
    if (examId) {
      await service.from('exams').delete().eq('id', examId);
    }
    for (const userId of userIds) {
      await service.auth.admin.deleteUser(userId);
    }
  }
});
