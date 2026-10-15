#!/usr/bin/env node
/**
 * RLS checks with real user tokens (anti_cheat hosted verification).
 *
 * The shared harness (./lib/harness.mjs) documents the full contract; this file
 * keeps a slim local bootstrap so the suite can be run with just
 * SUPABASE_URL + SUPABASE_ANON_KEY exported.
 */
import { createClient } from '@supabase/supabase-js';
import { buildExamPayload, loadEnv, shortId } from './lib/harness.mjs';

// Pick up VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (and server overrides) from
// .env.local / .env when they are not already exported.
loadEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const password = process.env.SEED_PASSWORD ?? 'ExamDemo!234';

if (!url || !anonKey) {
  console.error(
    'Aborting: SUPABASE_URL and SUPABASE_ANON_KEY are required (or VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
  );
  process.exit(1);
}

function client(email) {
  const c = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return c;
}

async function signIn(c, email) {
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
}

let failures = 0;
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const expectRows = async (c, name, selectFn, expected, op = '===') => {
  const { data, error } = await selectFn();
  if (error) throw new Error(`${name}: unexpected error: ${error.message}`);
  const n = (data ?? []).length;
  const ok = op === '===' ? n === expected : n > 0;
  if (!ok) throw new Error(`${name}: expected ${op} ${expected} rows, got ${n}`);
  return data;
};

async function main() {
  const teacher1 = client('teacher1');
  const teacher2 = client('teacher2');
  const admin = client('admin');
  const student1 = client('student1');
  const student2 = client('student2');
  await signIn(teacher1, 'teacher1@exam.test');
  await signIn(teacher2, 'teacher2@exam.test');
  await signIn(admin, 'admin@exam.test');
  await signIn(student1, 'student1@exam.test');
  await signIn(student2, 'student2@exam.test');

  // Locate the demo course + exam.
  const courseRows = await expectRows(
    teacher1,
    'demo course locate',
    () => teacher1.from('courses').select('id,title').eq('course_code', 'SOP101'),
    1,
    '>=',
  );
  const courseId = courseRows[0].id;
  const examRows = await expectRows(
    teacher1,
    'demo exam locate',
    () => teacher1.from('exams').select('id,title').eq('course_id', courseId).eq('state', 'published'),
    1,
    '>=',
  );
  const examId = examRows[0].id;

  console.log(`\nCourse ${courseId}, exam ${examId}\n`);

  // The attempt lifecycle is single-use per student/exam, so create a fresh
  // published exam each run to keep the suite re-runnable (the demo exam gets
  // consumed by the first lifecycle run). Ownership/visibility checks above
  // still target the stable demo exam.
  const { data: lifecycleExamId, error: lifecycleSaveErr } = await teacher1.rpc('save_exam_draft', {
    p_exam_id: null,
    p_payload: buildExamPayload({ courseId, title: `RLS lifecycle ${shortId()}`, questionCount: 3 }),
  });
  if (lifecycleSaveErr) throw new Error(`lifecycle save_exam_draft: ${lifecycleSaveErr.message}`);
  const { error: lifecyclePublishErr } = await teacher1.rpc('publish_exam', {
    p_exam_id: lifecycleExamId,
  });
  if (lifecyclePublishErr) throw new Error(`lifecycle publish_exam: ${lifecyclePublishErr.message}`);

  console.log('RLS checks (real user tokens):');

  // --- Owner / teacher access is present ----------------------------------
  await check('teacher1 sees own course', async () => {
    const data = await expectRows(teacher1, null, () => teacher1.from('courses').select('id').eq('id', courseId), 1);
    if (data.length !== 1) throw new Error('missing course');
  });
  await check('teacher1 sees exactly one key per own exam question (draft + frozen)', async () => {
    // SOP 94/171: the working draft and the immutable published version coexist,
    // so the owner legitimately sees both key sets. Scope the assertion to the
    // located exam and require exactly one key per question, regardless of how
    // many versions/drafts exist.
    const questions = await expectRows(
      teacher1,
      null,
      () => teacher1.from('exam_questions').select('id').eq('exam_id', examId),
      50,
      '>',
    );
    const questionIds = questions.map((q) => q.id);
    const scoped = await expectRows(
      teacher1,
      null,
      () => teacher1.from('answer_keys').select('question_id').in('question_id', questionIds),
      questionIds.length,
    );
    if (new Set(scoped.map((r) => r.question_id)).size !== questionIds.length) {
      throw new Error('expected exactly one key per exam question');
    }
  });

  // --- Cross-teacher isolation (acceptance 2) -----------------------------
  await check('teacher2 cannot read teacher1 course', async () => {
    await expectRows(teacher2, null, () => teacher2.from('courses').select('id').eq('id', courseId), 0);
  });
  await check('teacher2 cannot read teacher1 exam', async () => {
    await expectRows(teacher2, null, () => teacher2.from('exams').select('id').eq('id', examId), 0);
  });
  await check('teacher2 cannot read answer keys', async () => {
    await expectRows(teacher2, null, () => teacher2.from('answer_keys').select('question_id'), 0);
  });
  await check('teacher2 cannot read student1 profile', async () => {
    await expectRows(teacher2, null, () => teacher2.from('profiles').select('id').eq('email', 'student1@exam.test'), 0);
  });

  // --- Students: enrolled vs unenrolled (acceptance 3, 4) -----------------
  await check('student1 (approved) sees the published exam', async () => {
    await expectRows(student1, null, () => student1.from('exams').select('id').eq('id', examId), 1);
  });
  await check('student2 (unenrolled) cannot see the exam', async () => {
    await expectRows(student2, null, () => student2.from('exams').select('id').eq('id', examId), 0);
  });
  await check('student2 cannot see the course', async () => {
    await expectRows(student2, null, () => student2.from('courses').select('id').eq('id', courseId), 0);
  });
  await check('student2 cannot guess questions by id', async () => {
    await expectRows(student2, null, () => student2.from('exam_questions').select('id').eq('exam_id', examId), 0);
  });

  // --- Answer-key confidentiality (acceptance 6) --------------------------
  await check('student1 has no direct access to exam_questions', async () => {
    await expectRows(student1, null, () => student1.from('exam_questions').select('id').eq('exam_id', examId), 0);
  });
  await check('student1 has no direct access to question_options', async () => {
    await expectRows(student1, null, () => student1.from('question_options').select('id').limit(50), 0);
  });
  await check('student1 has no direct access to answer_keys', async () => {
    await expectRows(student1, null, () => student1.from('answer_keys').select('question_id'), 0);
  });
  await check('student1 has no access to course_join_codes', async () => {
    await expectRows(student1, null, () => student1.from('course_join_codes').select('id').eq('course_id', courseId), 0);
  });
  await check('teacher1 can read join-code metadata but not the hash/cipher columns', async () => {
    const meta = await teacher1
      .from('course_join_codes')
      .select('id,code_hint,active')
      .eq('course_id', courseId);
    if (meta.error) throw new Error(`metadata select failed: ${meta.error.message}`);
    const hash = await teacher1
      .from('course_join_codes')
      .select('code_hash')
      .eq('course_id', courseId);
    if (!hash.error) throw new Error('code_hash must not be selectable');
    const cipher = await teacher1
      .from('course_join_codes')
      .select('code_cipher')
      .eq('course_id', courseId);
    if (!cipher.error) throw new Error('code_cipher must not be selectable');
  });
  await check('teacher2 cannot read teacher1 join codes via RPC', async () => {
    const { error } = await teacher2.rpc('get_join_code', { p_course_id: courseId });
    if (!error) throw new Error('expected rejection for a non-owner');
  });

  // --- Attempt lifecycle through RPCs -------------------------------------
  let attemptId = null;
  let controllerToken = null;
  await check('student1 can start an attempt on a published exam', async () => {
    const { data, error } = await student1.rpc('start_attempt', { p_exam_id: lifecycleExamId });
    if (error) throw new Error(`start_attempt: ${error.message}`);
    if (!data?.attempt_id) throw new Error('no attempt_id returned');
    attemptId = data.attempt_id;
    controllerToken = data.controller_token;
  });
  await check('student2 cannot start an attempt (not enrolled)', async () => {
    const { error } = await student2.rpc('start_attempt', { p_exam_id: lifecycleExamId });
    if (!error) throw new Error('expected rejection');
  });
  await check('student1 payload carries no answer-key material', async () => {
    const { data, error } = await student1.rpc('get_attempt_payload', { p_attempt_id: attemptId });
    if (error) throw new Error(`get_attempt_payload: ${error.message}`);
    const blob = JSON.stringify(data);
    for (const forbidden of ['correct_option_id', 'answer_keys', 'answer_key', 'correct_index']) {
      if (blob.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(`payload leaked ${forbidden}`);
      }
    }
  });
  await check('student2 cannot read student1 attempt', async () => {
    await expectRows(student2, null, () => student2.from('exam_attempts').select('id').eq('id', attemptId), 0);
  });
  await check('teacher2 cannot read student1 attempt', async () => {
    await expectRows(teacher2, null, () => teacher2.from('exam_attempts').select('id').eq('id', attemptId), 0);
  });
  await check('student2 cannot read student1 attempt review via RPC', async () => {
    const { error } = await student2.rpc('get_attempt_review', { p_attempt_id: attemptId });
    if (!error) throw new Error('expected rejection for a non-owner student');
  });
  await check('teacher2 (not course owner) cannot read attempt review via RPC', async () => {
    const { error } = await teacher2.rpc('get_attempt_review', { p_attempt_id: attemptId });
    if (!error) throw new Error('expected rejection for a non-owner teacher');
  });

  // --- Immutability: no direct UPDATE path (acceptance 17) ----------------
  await check('student1 cannot forge score via direct update', async () => {
    const { error } = await student1
      .from('exam_attempts')
      .update({ earned_points: 100 })
      .eq('id', attemptId);
    if (!error) throw new Error('direct update was allowed');
  });
  await check('teacher1 cannot alter submit state via direct update', async () => {
    const { error } = await teacher1
      .from('exam_attempts')
      .update({ state: 'submitted' })
      .eq('id', attemptId);
    if (!error) throw new Error('direct update was allowed');
  });
  await check('student1 cannot write to answer_keys', async () => {
    const { error } = await student1.from('answer_keys').insert({ question_id: '00000000-0000-0000-0000-000000000000', correct_option_id: '00000000-0000-0000-0000-000000000000' });
    if (!error) throw new Error('direct insert was allowed');
  });

  // --- Admin: full visibility ---------------------------------------------
  await check('admin can read answer keys across exams', async () => {
    await expectRows(admin, null, () => admin.from('answer_keys').select('question_id').limit(1), 1, '>');
  });
  await check('admin can read all profiles', async () => {
    await expectRows(admin, null, () => admin.from('profiles').select('id').limit(1), 1, '>');
  });

  const summary = `RLS checks: ${checks - failures}/${checks} passed`;
  console.log(`\n${summary}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('RLS test runner error:', err);
  process.exit(1);
});
