#!/usr/bin/env node
/**
 * Hosted verification — concurrency, finality, and session recovery.
 *
 * Exercises races the UI cannot reliably create: simultaneous submit/violation/
 * save, duplicate-episode storms, controller-lease rotation, clock independence,
 * and bulk expiry finalization. Every call uses a REAL signed-in user token.
 *
 * Run: node supabase/tests/concurrency.test.mjs
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
const runner = createRunner('concurrency');
const fixture = { run, users: {}, courses: [], exams: {}, attempts: {} };
const email = (name) => `${name}-${run}@exam.test`;
const uuid = () => crypto.randomUUID();
const SIGNALS = ['focus_lost', 'visibility_hidden', 'fullscreen_exit'];

const rpc = (client, fn, args) => client.rpc(fn, args);

async function publishExam(teacherC, courseId, title, opts = {}) {
  const payload = buildExamPayload({ courseId, title, ...opts });
  const { data: id, error } = await rpc(teacherC, 'save_exam_draft', { p_exam_id: null, p_payload: payload });
  assertNoError(error, `save_exam_draft ${title}`);
  const { data: vid, error: pubErr } = await rpc(teacherC, 'publish_exam', { p_exam_id: id });
  assertNoError(pubErr, `publish_exam ${title}`);
  fixture.exams[title] = id;
  return { examId: id, versionId: vid };
}

async function startAndSave(studentC, examId, versionId, count) {
  const { data: started, error } = await rpc(studentC, 'start_attempt', { p_exam_id: examId });
  assertNoError(error, 'start_attempt');
  const keyMap = await fetchKeyMap(service, versionId);
  const payload = (await rpc(studentC, 'get_attempt_payload', { p_attempt_id: started.attempt_id })).data;
  for (const q of payload.questions.slice(0, count)) {
    const { data } = await rpc(studentC, 'save_answer', {
      p_attempt_id: started.attempt_id,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: started.controller_token,
    });
    assert(data?.accepted, `save_answer not accepted: ${data?.reason}`);
  }
  return { ...started, keyMap, payload };
}

async function main() {
  console.log(`Hosted concurrency verification (run ${run})\nProject: ${new URL(cfg.url).host}\n`);

  const admin = await createUser(service, email('admin'), 'Admin', password);
  const teacher = await createUser(service, email('teacher'), 'Teacher', password);
  const student = await createUser(service, email('student'), 'Student', password);
  fixture.users = { admin: admin.id, teacher: teacher.id, student: student.id };
  await setRole(service, admin.id, 'admin');
  const adminC = await signIn(cfg, email('admin'), password);
  await adminC.rpc('admin_set_role', { p_user_id: teacher.id, p_role: 'teacher' });
  const teacherC = await signIn(cfg, email('teacher'), password);
  const studentC = await signIn(cfg, email('student'), password);

  const { data: course } = await teacherC.rpc('create_course', {
    p_title: 'Concurrency Course',
    p_description: '',
    p_section: '',
    p_academic_term: '2026',
    p_course_code: `CC${run.toUpperCase().slice(0, 8)}`.slice(0, 12),
  });
  const courseId = course.course_id;
  fixture.courses.push(courseId);
  const { data: req } = await studentC.rpc('request_enrollment', { p_join_code: course.join_code });
  await teacherC.rpc('decide_enrollment', { p_enrollment_id: req.enrollment_id, p_decision: 'approved' });

  // === Race: submit vs violation vs save ==================================
  await runner.check('racing submit/violation/save yields one final result', async () => {
    const { examId, versionId } = await publishExam(teacherC, courseId, 'Race Exam', { questionCount: 20 });
    const started = await startAndSave(studentC, examId, versionId, 8);
    fixture.attempts.race = started.attempt_id;
    const payload = started.payload;

    const [submitRes, violationRes, saveRes] = await Promise.all([
      rpc(studentC, 'submit_attempt', { p_attempt_id: started.attempt_id, p_controller_token: started.controller_token }),
      rpc(studentC, 'record_violation', {
        p_attempt_id: started.attempt_id,
        p_episode_id: uuid(),
        p_signals: SIGNALS,
        p_observed_at: new Date().toISOString(),
        p_controller_token: started.controller_token,
      }),
      rpc(studentC, 'save_answer', {
        p_attempt_id: started.attempt_id,
        p_question_id: payload.questions[10].id,
        p_option_id: started.keyMap[payload.questions[10].id],
        p_revision: 1,
        p_request_id: uuid(),
        p_controller_token: started.controller_token,
      }),
    ]);
    assertNoError(submitRes.error, 'racing submit');
    assertNoError(violationRes.error, 'racing violation');
    assertNoError(saveRes.error, 'racing save');

    const { data: result } = await studentC.rpc('get_result', { p_attempt_id: started.attempt_id });
    assertEquals(result.attempt_state, 'submitted', 'final state submitted');
    assert(
      ['manual', 'violation_limit', 'time_expired'].includes(result.submission_reason),
      `valid reason (got ${result.submission_reason})`,
    );
    assert(result.violation_count <= 2, 'violation count within bounds');

    const { data: again } = await studentC.rpc('submit_attempt', {
      p_attempt_id: started.attempt_id,
      p_controller_token: started.controller_token,
    });
    assertEquals(Number(again.earned_points), Number(result.earned_points), 'score stable on re-submit');
  });

  // === Duplicate-episode storm counts exactly once ========================
  await runner.check('10 concurrent identical episodes count once', async () => {
    const { examId, versionId } = await publishExam(teacherC, courseId, 'Storm Exam', { questionCount: 5 });
    const started = await startAndSave(studentC, examId, versionId, 2);
    fixture.attempts.storm = started.attempt_id;
    const episodeId = uuid();
    const calls = Array.from({ length: 10 }, () =>
      rpc(studentC, 'record_violation', {
        p_attempt_id: started.attempt_id,
        p_episode_id: episodeId,
        p_signals: SIGNALS,
        p_observed_at: new Date().toISOString(),
        p_controller_token: started.controller_token,
      }),
    );
    const results = await Promise.all(calls);
    for (const r of results) assertNoError(r.error, 'storm violation');
    const { data: payload } = await rpc(studentC, 'get_attempt_payload', { p_attempt_id: started.attempt_id });
    assertEquals(payload.attempt.violation_count, 1, 'exactly one count');
    assertEquals(payload.attempt.state, 'in_progress', 'not finalized below threshold');
  });

  // === Clock independence =================================================
  await runner.check('client-supplied observed_at cannot bend the server clock', async () => {
    const { examId, versionId } = await publishExam(teacherC, courseId, 'Clock Exam', { questionCount: 5 });
    const started = await startAndSave(studentC, examId, versionId, 1);
    fixture.attempts.clock = started.attempt_id;
    const before = (await rpc(studentC, 'get_attempt_payload', { p_attempt_id: started.attempt_id })).data.attempt;

    const { data, error } = await rpc(studentC, 'record_violation', {
      p_attempt_id: started.attempt_id,
      p_episode_id: uuid(),
      p_signals: SIGNALS,
      p_observed_at: '2099-01-01T00:00:00.000Z',
      p_controller_token: started.controller_token,
    });
    assertNoError(error, 'future observed_at');
    assertEquals(data.violation_count, 1, 'counted once regardless of timestamp');

    const after = (await rpc(studentC, 'get_attempt_payload', { p_attempt_id: started.attempt_id })).data.attempt;
    assertEquals(after.deadline_at, before.deadline_at, 'deadline unchanged');
  });

  // === Controller lease rotation + recovery ===============================
  await runner.check('controller lease rotation and recovery', async () => {
    const { examId, versionId } = await publishExam(teacherC, courseId, 'Controller Exam', { questionCount: 5 });
    const started = await startAndSave(studentC, examId, versionId, 1);
    fixture.attempts.controller = started.attempt_id;
    const token = started.controller_token;

    const same = await rpc(studentC, 'acquire_attempt_controller', {
      p_attempt_id: started.attempt_id,
      p_current_token: token,
    });
    assertEquals(same.data.controller_token, token, 'current holder keeps the lease');

    const clash = await rpc(studentC, 'acquire_attempt_controller', {
      p_attempt_id: started.attempt_id,
      p_current_token: uuid(),
    });
    assert(clash.error, 'active lease blocks another session');

    // Force the lease to expire, then a fresh session may take over.
    await service
      .from('exam_attempts')
      .update({ controller_lease_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', started.attempt_id);
    const rotated = await rpc(studentC, 'acquire_attempt_controller', {
      p_attempt_id: started.attempt_id,
      p_current_token: uuid(),
    });
    assertNoError(rotated.error, 'recover after lease expiry');
    const newToken = rotated.data.controller_token;
    assert(newToken !== token, 'token rotated');

    const stale = await rpc(studentC, 'save_answer', {
      p_attempt_id: started.attempt_id,
      p_question_id: started.payload.questions[1].id,
      p_option_id: started.keyMap[started.payload.questions[1].id],
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    assertEquals(stale.data.reason, 'controller', 'old token rejected after rotation');

    const heartbeat = await rpc(studentC, 'heartbeat', {
      p_attempt_id: started.attempt_id,
      p_controller_token: token,
      p_seq: 1,
    });
    assert(heartbeat.error, 'heartbeat with stale token rejected');

    const fresh = await rpc(studentC, 'save_answer', {
      p_attempt_id: started.attempt_id,
      p_question_id: started.payload.questions[1].id,
      p_option_id: started.keyMap[started.payload.questions[1].id],
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: newToken,
    });
    assertEquals(fresh.data.accepted, true, 'new controller can answer');
  });

  // === Bulk expiry finalization ===========================================
  await runner.check('finalize_expired_attempts closes past-deadline attempts', async () => {
    const { examId, versionId } = await publishExam(teacherC, courseId, 'Expiry Exam', { questionCount: 5 });
    const started = await startAndSave(studentC, examId, versionId, 1);
    fixture.attempts.expiry = started.attempt_id;
    await service
      .from('exam_attempts')
      .update({ deadline_at: new Date(Date.now() - 5000).toISOString() })
      .eq('id', started.attempt_id);

    const { data: finalized, error } = await rpc(adminC, 'finalize_expired_attempts', {});
    assertNoError(error, 'finalize_expired_attempts');
    assert(finalized >= 1, 'at least one finalized');

    const { data: result } = await studentC.rpc('get_result', { p_attempt_id: started.attempt_id });
    assertEquals(result.attempt_state, 'submitted', 'submitted');
    assertEquals(result.submission_reason, 'time_expired', 'reason time_expired');
  });

  const state = runner.report();
  const manifest = saveManifest(`concurrency-${run}`, fixture);
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
  console.error('Concurrency verification aborted:', err.message);
  process.exit(1);
});
