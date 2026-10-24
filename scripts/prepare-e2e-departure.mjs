#!/usr/bin/env node
/**
 * Provision a self-contained fixture for the authenticated departure E2E.
 *
 * Creates a confirmed teacher + student, a course, an approved enrollment, and
 * a published exam the student can start immediately, then records the E2E_*
 * values the Playwright spec expects inside a managed block in the gitignored
 * `.env.server.local`. The generated password is written to that file only — it
 * is never printed to the terminal or committed.
 *
 * Usage:
 *   node scripts/prepare-e2e-departure.mjs
 *   npx playwright test tests/e2e/authenticated.exam.spec.ts --project=chromium --headed
 *
 * Re-running always provisions fresh users (unique run id) so a finalized
 * attempt from a previous run never blocks a new one.
 *
 * Required env (from the gitignored .env.server.local):
 *   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/load-env.mjs';
import {
  requireConfig,
  serviceClient,
  signIn,
  createUser,
  setRole,
  buildExamPayload,
  shortId,
  assertNoError,
} from '../supabase/tests/lib/harness.mjs';

const ENV_FILE = path.join(ROOT, '.env.server.local');
const START = '# >>> e2e-departure (managed by scripts/prepare-e2e-departure.mjs)';
const END = '# <<< e2e-departure';

function upsertManagedBlock(file, block) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.split('\n');
  const start = lines.findIndex((l) => l.trim() === START);
  const end = lines.findIndex((l) => l.trim() === END);
  let next;
  if (start !== -1 && end !== -1 && end > start) {
    next = [
      ...lines.slice(0, start),
      ...block.split('\n'),
      ...lines.slice(end + 1),
    ].join('\n');
  } else {
    const trimmed = current.replace(/\n+$/, '');
    next = `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`;
  }
  writeFileSync(file, next);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function clearBlock(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === START);
  const end = lines.findIndex((l) => l.trim() === END);
  if (start === -1 || end === -1 || end < start) {
    console.log('No managed e2e-departure block to clear.');
    return;
  }
  const before = lines.slice(0, start).join('\n').replace(/\n+$/, '');
  const after = lines.slice(end + 1);
  const next = [...(before ? [`${before}`, ''] : []), ...after].join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(file, next.startsWith('\n') ? next.slice(1) : next);
  console.log('Cleared the managed e2e-departure block from .env.server.local.');
}

async function main() {
  if (process.argv.includes('--clear')) {
    clearBlock(ENV_FILE);
    return;
  }
  const cfg = requireConfig({ service: true });
  const service = serviceClient(cfg);
  const run = shortId();
  const password = `Exam-${run}-Aa1`;
  const teacherEmail = `e2e-teacher-${run}@exam.test`;
  const studentEmail = `e2e-student-${run}@exam.test`;
  const adminEmail = `e2e-admin-${run}@exam.test`;

  const teacher = await createUser(service, teacherEmail, 'E2E Teacher', password);
  const student = await createUser(service, studentEmail, 'E2E Student', password);
  const admin = await createUser(service, adminEmail, 'E2E Admin', password);
  await setRole(service, teacher.id, 'teacher');
  await setRole(service, admin.id, 'admin');

  const teacherC = await signIn(cfg, teacherEmail, password);
  const studentC = await signIn(cfg, studentEmail, password);

  const { data: course, error: courseErr } = await teacherC.rpc('create_course', {
    p_title: 'E2E Departure Course',
    p_description: 'Authenticated departure E2E',
    p_section: 'A',
    p_academic_term: '2026',
    p_course_code: `E2E${run.toUpperCase()}`,
  });
  assertNoError(courseErr, 'create_course');
  const courseId = course.course_id;
  const joinCode = course.join_code;

  const { data: enrollment, error: enrollErr } = await studentC.rpc('request_enrollment', {
    p_join_code: joinCode,
  });
  assertNoError(enrollErr, 'request_enrollment');

  const { error: decideErr } = await teacherC.rpc('decide_enrollment', {
    p_enrollment_id: enrollment.enrollment_id,
    p_decision: 'approved',
  });
  assertNoError(decideErr, 'decide_enrollment');

  const payload = buildExamPayload({
    courseId,
    title: 'E2E Departure Exam',
    questionCount: 5,
    questionRandomization: true,
    optionRandomization: true,
    opensInMs: -60_000,
    closesInMs: 2 * 60 * 60 * 1000,
  });
  const { data: examId, error: saveErr } = await teacherC.rpc('save_exam_draft', {
    p_exam_id: null,
    p_payload: payload,
  });
  assertNoError(saveErr, 'save_exam_draft');

  const { error: publishErr } = await teacherC.rpc('publish_exam', { p_exam_id: examId });
  assertNoError(publishErr, 'publish_exam');

  const block = [
    START,
    'E2E_SUPABASE_CONFIGURED=true',
    `E2E_STUDENT_EMAIL=${studentEmail}`,
    `E2E_STUDENT_PASSWORD=${password}`,
    `E2E_ADMIN_EMAIL=${adminEmail}`,
    `E2E_ADMIN_PASSWORD=${password}`,
    `E2E_EXAM_ID=${examId}`,
    END,
  ].join('\n');
  upsertManagedBlock(ENV_FILE, block);

  console.log('\nE2E departure fixture ready');
  console.log('  run id       :', run);
  console.log('  project      :', new URL(cfg.url).host);
  console.log('  student      :', studentEmail);
  console.log('  admin        :', adminEmail);
  console.log('  exam id      :', examId);
  console.log('  env file     : .env.server.local (password written there, not printed)');
  console.log('  teacher      :', teacherEmail, `(role teacher, id ${teacher.id.slice(0, 8)}…)`);
  console.log('\nNext: npx playwright test tests/e2e/authenticated.exam.spec.ts --project=chromium --headed\n');
}

main().catch((err) => fail(err?.message ?? String(err)));
