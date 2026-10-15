#!/usr/bin/env node
/**
 * Hosted verification — finality & immutability.
 *
 * Proves the "final score is final" invariants with REAL signed-in user tokens:
 * repeated/simultaneous submits are idempotent, and no user-facing path
 * (student, teacher, admin) can rewrite final score fields, state, warning
 * count, or answers once the attempt is submitted. Service role is used only
 * for fixture setup (and deliberately bypasses RLS — it is not a user path).
 *
 * Requires a live project and SUPABASE_SERVICE_ROLE_KEY; exits 2 (BLOCKED) when
 * configuration is missing.
 *
 * Run: node supabase/tests/finality.test.mjs
 */
import {
  ROOT,
  assert,
  assertEquals,
  assertNoError,
  bestEffortCleanup,
  buildExamPayload,
  createRunner,
  createUser,
  fetchKeyMap,
  reportLeftovers,
  requireConfig,
  saveManifest,
  serviceClient,
  setRole,
  shortId,
  signIn,
} from './lib/harness.mjs';

const cfg = requireConfig({ service: true });
const service = serviceClient(cfg);
const run = shortId();
const password = `Exam-${run}-Aa1`;
const runner = createRunner('finality');
const fixture = { run, users: {}, courses: [], exams: {}, attempts: {} };
const email = (name) => `${name}-${run}@exam.test`;
const uuid = () => crypto.randomUUID();

async function main() {
  console.log(`Hosted finality verification (run ${run})\nProject: ${new URL(cfg.url).host}\n`);

  const admin = await createUser(service, email('admin'), 'Admin', password);
  const teacher = await createUser(service, email('teacher'), 'Teacher', password);
  const student = await createUser(service, email('student'), 'Student', password);
  const peer = await createUser(service, email('peer'), 'Peer', password);
  fixture.users = { admin: admin.id, teacher: teacher.id, student: student.id, peer: peer.id };
  await setRole(service, admin.id, 'admin');

  const adminC = await signIn(cfg, email('admin'), password);
  const teacherC = await signIn(cfg, email('teacher'), password);
  const studentC = await signIn(cfg, email('student'), password);
  const peerC = await signIn(cfg, email('peer'), password);

  const { error: promoteErr } = await adminC.rpc('admin_set_role', {
    p_user_id: teacher.id,
    p_role: 'teacher',
  });
  assertNoError(promoteErr, 'admin_set_role teacher');

  const courseCode = `FIN${run.slice(0, 5).toUpperCase()}`;
  const { data: course, error: courseErr } = await teacherC.rpc('create_course', {
    p_title: 'Finality Course',
    p_description: 'Hosted verification',
    p_section: 'A',
    p_academic_term: '2026',
    p_course_code: courseCode,
  });
  assertNoError(courseErr, 'create_course');
  const courseId = course.course_id;
  fixture.courses.push(courseId);
  const { data: req } = await studentC.rpc('request_enrollment', { p_join_code: course.join_code });
  await teacherC.rpc('decide_enrollment', { p_enrollment_id: req.enrollment_id, p_decision: 'approved' });

  const payload = buildExamPayload({ courseId, title: 'Finality Exam', questionCount: 5 });
  const { data: examId, error: saveErr } = await teacherC.rpc('save_exam_draft', {
    p_exam_id: null,
    p_payload: payload,
  });
  assertNoError(saveErr, 'save_exam_draft');
  fixture.exams.main = examId;
  const { data: versionId } = await teacherC.rpc('publish_exam', { p_exam_id: examId });
  const keyMap = await fetchKeyMap(service, versionId);

  const { data: started } = await studentC.rpc('start_attempt', { p_exam_id: examId });
  const attemptId = started.attempt_id;
  const token = started.controller_token;
  fixture.attempts.main = attemptId;
  const p = (await studentC.rpc('get_attempt_payload', { p_attempt_id: attemptId })).data;
  for (const q of p.questions) {
    await studentC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: token,
    });
  }
  const { data: final, error: finalErr } = await studentC.rpc('submit_attempt', {
    p_attempt_id: attemptId,
    p_controller_token: token,
  });
  assertNoError(finalErr, 'submit_attempt');

  console.log('Finality & immutability checks (real user tokens):');

  await runner.check('final result is submitted with the computed score', async () => {
    assertEquals(final.attempt_state, 'submitted', 'submitted');
    assertEquals(final.submission_reason, 'manual', 'reason manual');
    assertEquals(Number(final.earned_points), 5, 'earned 5');
    assertEquals(Number(final.max_points), 5, 'max 5');
    assertEquals(Number(final.percentage), 100, 'percentage 100');
  });

  await runner.check('simultaneous re-submits return the identical final result', async () => {
    const calls = await Promise.all(
      Array.from({ length: 4 }, () =>
        studentC.rpc('submit_attempt', { p_attempt_id: attemptId, p_controller_token: token }),
      ),
    );
    for (const r of calls) {
      assertNoError(r.error, 'idempotent submit');
      assertEquals(r.data.attempt_state, 'submitted', 'still submitted');
      assertEquals(Number(r.data.earned_points), 5, 'score unchanged');
      assertEquals(r.data.submission_reason, 'manual', 'reason unchanged');
    }
  });

  await runner.check('student cannot alter final fields via direct update', async () => {
    const { error } = await studentC
      .from('exam_attempts')
      .update({ earned_points: 0, percentage: 0, state: 'in_progress', violation_count: 0 })
      .eq('id', attemptId);
    assert(error, 'student direct update must be denied');
  });

  await runner.check('teacher cannot alter final state via direct update', async () => {
    const { error } = await teacherC
      .from('exam_attempts')
      .update({ state: 'in_progress', earned_points: 999 })
      .eq('id', attemptId);
    assert(error, 'teacher direct update must be denied');
  });

  await runner.check('admin cannot alter final state via direct update', async () => {
    const { error } = await adminC
      .from('exam_attempts')
      .update({ state: 'in_progress', earned_points: 999 })
      .eq('id', attemptId);
    assert(error, 'admin direct update must be denied');
  });

  await runner.check('no user-facing role can delete the finalized attempt', async () => {
    const { error } = await adminC.from('exam_attempts').delete().eq('id', attemptId);
    assert(error, 'attempt delete must be denied');
  });

  await runner.check('answer writes are rejected after finalize', async () => {
    const { data, error } = await studentC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: p.questions[0].id,
      p_option_id: keyMap[p.questions[0].id],
      p_revision: 99,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    assertNoError(error, 'late save_answer');
    assertEquals(data.accepted, false, 'not accepted');
    assertEquals(data.reason, 'finalized', 'reason finalized');
  });

  await runner.check('violation reporting after finalize cannot change the count', async () => {
    const { data, error } = await studentC.rpc('record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: uuid(),
      p_signals: ['focus_lost', 'visibility_hidden', 'fullscreen_exit'],
      p_observed_at: new Date().toISOString(),
      p_controller_token: token,
    });
    assertNoError(error, 'post-finalize violation');
    assertEquals(data.finalized, true, 'still finalized');
    assertEquals(data.violation_count, 0, 'count frozen');
  });

  await runner.check('owner teacher can read the result; peer student cannot', async () => {
    const { error: ownerErr } = await teacherC.rpc('get_result', { p_attempt_id: attemptId });
    assertNoError(ownerErr, 'teacher get_result');
    const { error: peerErr } = await peerC.rpc('get_result', { p_attempt_id: attemptId });
    assert(peerErr, 'peer must not read the result');
  });

  await runner.check('a passed server deadline forces time_expired over manual', async () => {
    const p2 = buildExamPayload({ courseId, title: 'Finality Deadline Exam', questionCount: 3 });
    const { data: savedId } = await teacherC.rpc('save_exam_draft', { p_exam_id: null, p_payload: p2 });
    fixture.exams.deadline = savedId;
    await teacherC.rpc('publish_exam', { p_exam_id: savedId });
    const { data: second } = await studentC.rpc('start_attempt', { p_exam_id: savedId });
    fixture.attempts.deadline = second.attempt_id;
    // Force the deadline into the past from the trusted side, then submit.
    await service
      .from('exam_attempts')
      .update({ deadline_at: new Date(Date.now() - 5000).toISOString() })
      .eq('id', second.attempt_id);
    const { data, error } = await studentC.rpc('submit_attempt', {
      p_attempt_id: second.attempt_id,
      p_controller_token: second.controller_token,
    });
    assertNoError(error, 'submit past deadline');
    assertEquals(data.submission_reason, 'time_expired', 'deadline precedence');
  });

  const state = runner.report();
  const manifest = saveManifest(`finality-${run}`, fixture);
  console.log(`Fixture manifest: ${manifest.replace(ROOT, '.')}`);

  const leftovers = await bestEffortCleanup({
    service,
    courses: fixture.courses,
    users: Object.values(fixture.users),
  });
  reportLeftovers(leftovers);

  if (state.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Finality verification aborted:', err.message);
  process.exit(1);
});
