import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const enabled = process.env.E2E_ANSWER_INTEGRITY === 'true';
const email = process.env.E2E_STUDENT_EMAIL;
const password = process.env.E2E_STUDENT_PASSWORD;
const examId = process.env.E2E_EXAM_ID;
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type SaveRequestBody = {
  p_attempt_id: string;
  p_question_id: string;
  p_option_id: string | null;
  p_revision: number;
  p_request_id: string;
};

test.describe('answer integrity with sequential navigation', () => {
  test.skip(!enabled || !email || !password || !examId || !supabaseUrl || !serviceKey, 'dedicated answer-integrity fixture not enabled');
  test.skip(({ browserName }) => browserName !== 'chromium', 'dedicated scenario runs once in Chromium');

  test('B remains mapped, changes to C, clears, reloads, and reviews the graded selection', async ({ page }) => {
    test.setTimeout(120_000);
    const service = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });

    // Exercise the same capability-based layout used by iOS browsers without
    // manufacturing fullscreen violations during the reload recovery check.
    await page.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    });

    // Deliver lower revisions later than newer revisions.
    await page.route('**/rest/v1/rpc/save_answer', async (route) => {
      const body = route.request().postDataJSON() as { p_revision?: number } | null;
      const revision = body?.p_revision ?? 1;
      const delay = revision === 1 ? 550 : revision === 2 ? 300 : 60;
      await new Promise((resolve) => setTimeout(resolve, delay));
      await route.continue();
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/student(?:\/|$)/, { timeout: 15_000 });
    await page.goto(`/student/exams/${examId}`);
    await page.getByRole('checkbox', { name: /accept the exam rules/i }).check();
    await page.getByRole('button', { name: /start exam|enter fullscreen & start/i }).click();
    await expect(page.getByText(/focused layout.*fullscreen unavailable/i)).toBeVisible();

    const prompt = page.locator('.question-card h2');
    const next = page.getByRole('button', { name: /next/i });
    const previous = page.getByRole('button', { name: /previous/i });
    const q1Prompt = await prompt.textContent();
    expect(q1Prompt).toBeTruthy();

    // Status numbers and the bookmark summary are display-only.
    await expect(page.locator('.q-dot')).toHaveCount(5);
    await expect(page.locator('.q-dot').first()).not.toHaveAttribute('role', 'button');
    const progress = page.getByRole('progressbar', { name: 'Answered questions' });
    const counts = page.getByLabel('Question counts');
    await expect(progress).toHaveAttribute('aria-valuemax', '5');
    await expect(progress).toHaveAttribute('aria-valuenow', '0');
    await expect(counts).toContainText('0 answered');
    await expect(counts).toContainText('5 unanswered');
    await page.locator('.q-dot').nth(4).click();
    await expect(prompt).toHaveText(q1Prompt!);

    const q1B = page.getByRole('radio', { name: /choice 2$/i });
    const q1C = page.getByRole('radio', { name: /choice 3$/i });
    const q1BRequestPromise = page.waitForRequest('**/rest/v1/rpc/save_answer');
    await q1B.check();
    const q1BRequest = await q1BRequestPromise;
    const q1BBody = q1BRequest.postDataJSON() as SaveRequestBody;
    await expect(next).toBeDisabled();
    const q1BResponse = await q1BRequest.response();
    expect(q1BResponse?.ok()).toBe(true);
    expect(await q1BResponse?.json()).toMatchObject({ accepted: true, reason: 'saved', revision: 1 });
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    await expect(counts).toContainText('1 answered');
    await expect(counts).toContainText('4 unanswered');
    await page.getByRole('button', { name: /mark for review/i }).click();
    await expect(page.getByText(/marked questions:/i)).toContainText('1');
    await expect(counts).toContainText('1 marked');
    await expect(next).toBeEnabled();
    await next.click();

    const q2Prompt = await prompt.textContent();
    const q2D = page.getByRole('radio', { name: /choice 4$/i });
    await q2D.check();
    await expect(previous).toBeDisabled();
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(prompt).toHaveText(q1Prompt!);
    await expect(q1B).toBeChecked();

    const q1CRequestPromise = page.waitForRequest('**/rest/v1/rpc/save_answer');
    await q1C.check();
    const q1CRequest = await q1CRequestPromise;
    const q1CBody = q1CRequest.postDataJSON() as SaveRequestBody;
    const q1CResponse = await q1CRequest.response();
    expect(q1CResponse?.ok()).toBe(true);
    expect(await q1CResponse?.json()).toMatchObject({ accepted: true, reason: 'saved', revision: 2 });
    expect(q1CBody).toMatchObject({
      p_attempt_id: q1BBody.p_attempt_id,
      p_question_id: q1BBody.p_question_id,
      p_revision: q1BBody.p_revision + 1,
    });
    expect(q1CBody.p_option_id).not.toBe(q1BBody.p_option_id);
    expect(q1CBody.p_request_id).not.toBe(q1BBody.p_request_id);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(prompt).toHaveText(q2Prompt!);
    await expect(q2D).toBeChecked();

    // Reload recovery starts at the first persisted question but retains every
    // accepted selection and the original shuffled option mapping.
    await page.reload();
    await expect(prompt).toHaveText(q1Prompt!);
    await expect(q1C).toBeChecked();
    const warningContinue = page.getByRole('button', { name: /continue exam/i });
    await warningContinue.waitFor({ state: 'visible', timeout: 5_000 }).then(
      () => warningContinue.click(),
      () => undefined,
    );
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
    await expect(prompt).toHaveText(q2Prompt!);
    await expect(q2D).toBeChecked();
    await next.click();

    // Rapid A -> C -> B; revision 3 reaches the server before 1 and 2.
    await page.getByRole('radio', { name: /choice 1$/i }).check();
    await page.getByRole('radio', { name: /choice 3$/i }).check();
    await page.getByRole('radio', { name: /choice 2$/i }).check();
    await expect(next).toBeEnabled();
    await next.click();

    // A clear is an explicit null save and survives navigation/finalization.
    const q4Prompt = await prompt.textContent();
    await page.getByRole('radio', { name: /choice 1$/i }).check();
    await expect(page.getByRole('button', { name: /clear answer/i })).toBeEnabled();
    await page.getByRole('button', { name: /clear answer/i }).click();
    await expect(progress).toHaveAttribute('aria-valuenow', '3');
    await expect(next).toBeEnabled();
    await next.click();

    await page.getByRole('radio', { name: /choice 1$/i }).check();
    await expect(progress).toHaveAttribute('aria-valuenow', '4');
    await expect(counts).toContainText('4 answered');
    await expect(counts).toContainText('1 unanswered');
    const submit = page.getByRole('button', { name: /^submit exam$/i }).last();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole('dialog')).toContainText('4 of 5');
    await expect(page.getByRole('dialog')).toContainText('1 question(s) are marked');
    await page.getByRole('button', { name: /confirm final submission/i }).click();
    await expect(page).toHaveURL(/\/result$/);

    const attemptId = await page.evaluate((id) => localStorage.getItem(`ace.attempt.${id}`), examId!);
    expect(attemptId).toBeTruthy();
    const answers = await service
      .from('attempt_answers')
      .select('question_id,selected_option_id,revision,question_options(label)')
      .eq('attempt_id', attemptId!);
    expect(answers.error).toBeNull();
    const q1Row = answers.data?.find((row) => row.question_id === q1CBody.p_question_id);
    expect(q1Row).toMatchObject({
      selected_option_id: q1CBody.p_option_id,
      revision: q1CBody.p_revision,
    });
    expect(q1Row?.question_options?.label).toMatch(/choice 3$/i);
    const cleared = answers.data?.find((row) => row.selected_option_id === null);
    expect(cleared).toBeTruthy();

    const result = await service.from('exam_attempts').select('correct_count').eq('id', attemptId!).single();
    const keys = await service.from('answer_keys').select('question_id,correct_option_id').in('question_id', answers.data!.map((row) => row.question_id));
    const expectedCorrect = answers.data!.filter((row) => keys.data?.some((key) => key.question_id === row.question_id && key.correct_option_id === row.selected_option_id)).length;
    expect(result.data?.correct_count).toBe(expectedCorrect);

    const reviewResponsePromise = page.waitForResponse('**/rest/v1/rpc/get_attempt_review');
    await page.getByRole('link', { name: /review answers/i }).click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.ok()).toBe(true);
    const review = await reviewResponse.json() as {
      questions: Array<{ id: string; selected_option_id: string | null }>;
    };
    expect(review.questions.find((question) => question.id === q1CBody.p_question_id)?.selected_option_id)
      .toBe(q1CBody.p_option_id);
    const q1Review = page.locator('.card').filter({ hasText: q1Prompt! });
    await expect(q1Review).toContainText(/choice 3/i);
    await expect(q1Review).toContainText('Your answer');
    const q4Review = page.locator('.card').filter({ hasText: q4Prompt! });
    await expect(q4Review).toContainText('You did not answer this question.');
  });
});
