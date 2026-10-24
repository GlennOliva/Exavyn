#!/usr/bin/env node
/**
 * Hosted verification — authenticated workflow acceptance.
 *
 * Drives the real RPC surface with REAL signed-in user tokens (anon key) and a
 * service-role client for fixture setup only. Proves the end-to-end exam
 * workflow and its security invariants. Requires a live project and
 * SUPABASE_SERVICE_ROLE_KEY; exits 2 (BLOCKED) when configuration is missing.
 *
 * Run: node supabase/tests/workflow.test.mjs
 */
import {
  ROOT,
  assert,
  assertEquals,
  assertNoError,
  assertRpcError,
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
const runner = createRunner('workflow');
const fixture = { run, users: {}, courses: [], exams: {} };
const email = (name) => `${name}-${run}@exam.test`;

const uuid = () => crypto.randomUUID();

async function main() {
  console.log(`Hosted workflow verification (run ${run})\nProject: ${new URL(cfg.url).host}\n`);

  // --- Fixtures -----------------------------------------------------------
  const admin = await createUser(service, email('admin'), 'Admin', password);
  const teacherA = await createUser(service, email('teacher-a'), 'Teacher A', password);
  const teacherB = await createUser(service, email('teacher-b'), 'Teacher B', password);
  const studentU = await createUser(service, email('student-u'), 'Student U', password);
  const studentP = await createUser(service, email('student-p'), 'Student P', password);
  const studentX = await createUser(service, email('student-x'), 'Student X', password);
  fixture.users = { admin: admin.id, teacherA: teacherA.id, teacherB: teacherB.id, studentU: studentU.id, studentP: studentP.id, studentX: studentX.id };

  await setRole(service, admin.id, 'admin');

  const adminC = await signIn(cfg, email('admin'), password);
  const teacherAC = await signIn(cfg, email('teacher-a'), password);
  const teacherBC = await signIn(cfg, email('teacher-b'), password);
  const studentUC = await signIn(cfg, email('student-u'), password);
  const studentPC = await signIn(cfg, email('student-p'), password);
  const studentXC = await signIn(cfg, email('student-x'), password);

  // --- Admin provisions teachers (acceptance 1) ---------------------------
  await runner.check('admin promotes a student to teacher', async () => {
    const { error } = await adminC.rpc('admin_set_role', { p_user_id: teacherA.id, p_role: 'teacher' });
    assertNoError(error, 'admin_set_role teacher-a');
    const { data } = await adminC.from('user_roles').select('role').eq('user_id', teacherA.id).single();
    assertEquals(data.role, 'teacher', 'role persisted');
  });
  await runner.check('non-admin cannot promote a teacher', async () => {
    await assertRpcError(
      await teacherBC.rpc('admin_set_role', { p_user_id: teacherB.id, p_role: 'teacher' }),
      'teacher-b self-promotion',
    );
  });
  await runner.check('admin promotes second teacher', async () => {
    const { error } = await adminC.rpc('admin_set_role', { p_user_id: teacherB.id, p_role: 'teacher' });
    assertNoError(error, 'admin_set_role teacher-b');
  });

  // --- Teacher creates course + enrollment (acceptance 2) -----------------
  const courseCode = `WF${run.toUpperCase().slice(0, 8)}`.slice(0, 12);
  let courseId;
  let joinCode;
  await runner.check('teacher creates course, join code returned once', async () => {
    const { data, error } = await teacherAC.rpc('create_course', {
      p_title: 'Workflow Course',
      p_description: 'Hosted verification',
      p_section: 'A',
      p_academic_term: '2026',
      p_course_code: courseCode,
    });
    assertNoError(error, 'create_course');
    assert(data?.course_id, 'course_id returned');
    assert(typeof data.join_code === 'string' && data.join_code.length >= 4, 'join_code returned');
    courseId = data.course_id;
    joinCode = data.join_code;
    fixture.courses.push(courseId);
  });
  await runner.check('teacher rotates the join code', async () => {
    const { data, error } = await teacherAC.rpc('rotate_join_code', { p_course_id: courseId });
    assertNoError(error, 'rotate_join_code');
    assert(data && data !== joinCode, 'new code differs from the original');
    joinCode = data;
  });

  let enrollmentU;
  await runner.check('student requests enrollment (pending)', async () => {
    const { data, error } = await studentUC.rpc('request_enrollment', { p_join_code: joinCode });
    assertNoError(error, 'request_enrollment student-u');
    assertEquals(data.status, 'pending', 'starts pending');
    enrollmentU = data.enrollment_id;
  });
  await runner.check('student requests enrollment and stays pending', async () => {
    const { data, error } = await studentPC.rpc('request_enrollment', { p_join_code: joinCode });
    assertNoError(error, 'request_enrollment student-p');
    assertEquals(data.status, 'pending', 'student-p pending');
  });
  await runner.check('another teacher cannot decide enrollment', async () => {
    await assertRpcError(
      await teacherBC.rpc('decide_enrollment', { p_enrollment_id: enrollmentU, p_decision: 'approved' }),
      'cross-teacher decide_enrollment',
    );
  });
  await runner.check('owner approves enrollment', async () => {
    const { data, error } = await teacherAC.rpc('decide_enrollment', {
      p_enrollment_id: enrollmentU,
      p_decision: 'approved',
    });
    assertNoError(error, 'decide_enrollment approved');
    assertEquals(data.status, 'approved', 'approved');
  });

  // --- Exam authoring + validation ----------------------------------------
  await runner.check('invalid exam payload is rejected (3 choices)', async () => {
    const bad = buildExamPayload({ courseId, title: 'Invalid' });
    bad.questions[0].options = bad.questions[0].options.slice(0, 3);
    const { error } = await teacherAC.rpc('save_exam_draft', { p_exam_id: null, p_payload: bad });
    assert(error, 'expected validation error');
  });

  let examId;
  let versionId;
  await runner.check('teacher saves a 50-item draft and publishes it', async () => {
    const payload = buildExamPayload({ courseId, title: 'Workflow Exam', questionCount: 50 });
    const { data: savedId, error: saveErr } = await teacherAC.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: payload,
    });
    assertNoError(saveErr, 'save_exam_draft');
    examId = savedId;
    fixture.exams.main = examId;

    const { data: vid, error: pubErr } = await teacherAC.rpc('publish_exam', { p_exam_id: examId });
    assertNoError(pubErr, 'publish_exam');
    versionId = vid;

    const { data: version } = await service
      .from('exam_versions')
      .select('item_count,max_score,frozen')
      .eq('id', vid)
      .single();
    assertEquals(version.item_count, 50, 'frozen item_count');
    assertEquals(Number(version.max_score), 50, 'frozen max_score');
    assertEquals(version.frozen, true, 'version frozen');
  });

  // --- Enrollment gate + payload confidentiality --------------------------
  await runner.check('pending student cannot start the exam', async () => {
    await assertRpcError(await studentPC.rpc('start_attempt', { p_exam_id: examId }), 'pending start');
  });
  await runner.check('unenrolled student cannot start the exam', async () => {
    await assertRpcError(await studentXC.rpc('start_attempt', { p_exam_id: examId }), 'unenrolled start');
  });

  // --- Time-window availability (published now, opens later) --------------
  await runner.check('published exam is visible before it opens', async () => {
    const payload = buildExamPayload({
      courseId,
      title: 'Upcoming Exam',
      questionCount: 3,
      opensInMs: 60 * 60 * 1000,
      closesInMs: 2 * 60 * 60 * 1000,
    });
    const { data: savedId, error: saveErr } = await teacherAC.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: payload,
    });
    assertNoError(saveErr, 'save upcoming exam');
    fixture.exams.upcoming = savedId;
    const { error: pubErr } = await teacherAC.rpc('publish_exam', { p_exam_id: savedId });
    assertNoError(pubErr, 'publish upcoming exam');

    const { data, error } = await studentUC
      .from('exams')
      .select('id,opens_at')
      .eq('id', savedId);
    assertNoError(error, 'list upcoming exam');
    assertEquals((data ?? []).length, 1, 'approved student can see the upcoming exam');
  });
  await runner.check('exam before its opening time is not startable', async () => {
    const { error } = await studentUC.rpc('start_attempt', { p_exam_id: fixture.exams.upcoming });
    assert(error, 'a not-yet-open exam must not be startable');
    assert(/has not opened yet/i.test(error.message), 'opening-time message preserved');
  });
  await runner.check('exam past its closing time is not startable', async () => {
    const payload = buildExamPayload({
      courseId,
      title: 'Expired Window Exam',
      questionCount: 3,
      opensInMs: -2 * 60 * 60 * 1000,
      closesInMs: -60 * 60 * 1000,
    });
    const { data: savedId, error: saveErr } = await teacherAC.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: payload,
    });
    assertNoError(saveErr, 'save expired-window exam');
    fixture.exams.expired = savedId;
    const { error: pubErr } = await teacherAC.rpc('publish_exam', { p_exam_id: savedId });
    assertNoError(pubErr, 'publish expired-window exam');

    const { error } = await studentUC.rpc('start_attempt', { p_exam_id: savedId });
    assert(error, 'an expired exam must not be startable');
    assert(/has closed/i.test(error.message), 'closing-time message preserved');
  });

  let attemptId;
  let token;
  await runner.check('approved student starts the exam', async () => {
    const { data, error } = await studentUC.rpc('start_attempt', { p_exam_id: examId });
    assertNoError(error, 'start_attempt student-u');
    assert(data?.attempt_id && data.controller_token, 'attempt + controller token returned');
    attemptId = data.attempt_id;
    token = data.controller_token;
  });
  await runner.check('resume with the held controller token returns the same attempt', async () => {
    const { data, error } = await studentUC.rpc('start_attempt', {
      p_exam_id: examId,
      p_current_token: token,
    });
    assertNoError(error, 'start_attempt resume');
    assertEquals(data.resumed, true, 'resumed flag');
    assertEquals(data.attempt_id, attemptId, 'same attempt id');
    assertEquals(data.controller_token, token, 'same controller token');
    assertEquals(data.violation_count, 0, 'no warnings reset');
  });
  await runner.check('resume without the controller token is rejected (single-controller)', async () => {
    const { error } = await studentUC.rpc('start_attempt', { p_exam_id: examId });
    assert(error, 'a second session cannot take a live attempt');
  });
  await runner.check('attempt payload leaks no answer-key material', async () => {
    const { data, error } = await studentUC.rpc('get_attempt_payload', { p_attempt_id: attemptId });
    assertNoError(error, 'get_attempt_payload');
    assertEquals(data.questions.length, 50, '50 questions delivered');
    const blob = JSON.stringify(data).toLowerCase();
    for (const forbidden of ['correct_option_id', 'correct_index', 'answer_key']) {
      assert(!blob.includes(forbidden), `payload must not contain "${forbidden}"`);
    }
    assert(data.questions.every((q) => q.saved_option_id === null), 'no saved answers yet');
  });

  // --- Answer persistence (server-side grading) ---------------------------
  const keyMap = await fetchKeyMap(service, versionId);
  const payload = (await studentUC.rpc('get_attempt_payload', { p_attempt_id: attemptId })).data;
  const answerable = payload.questions.slice(0, 30);

  await runner.check('30 answers are saved and graded by the server', async () => {
    for (const q of answerable) {
      const { data, error } = await studentUC.rpc('save_answer', {
        p_attempt_id: attemptId,
        p_question_id: q.id,
        p_option_id: keyMap[q.id],
        p_revision: 1,
        p_request_id: uuid(),
        p_controller_token: token,
      });
      assertNoError(error, `save_answer ${q.id}`);
      assertEquals(data.accepted, true, 'answer accepted');
    }
    const { data } = await service
      .from('attempt_answers')
      .select('id', { count: 'exact' })
      .eq('attempt_id', attemptId);
    assertEquals(data.length, 30, '30 answers persisted');
  });
  await runner.check('duplicate save (same request_id) is idempotent', async () => {
    const q = answerable[0];
    const requestId = uuid();
    await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 2,
      p_request_id: requestId,
      p_controller_token: token,
    });
    const { data, error } = await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 2,
      p_request_id: requestId,
      p_controller_token: token,
    });
    assertNoError(error, 'duplicate save');
    assertEquals(data.reason, 'duplicate', 'reported duplicate');
  });
  await runner.check('stale revision cannot overwrite a newer answer', async () => {
    const q = answerable[1];
    await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 5,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    const { data } = await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 4,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    assertEquals(data.accepted, false, 'older revision rejected');
    assertEquals(data.reason, 'stale', 'reason stale');
  });
  await runner.check('changing an answer persists the latest stable option id', async () => {
    const q = answerable[0];
    const wrong = q.options.find((option) => option.id !== keyMap[q.id]).id;
    await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId, p_question_id: q.id, p_option_id: wrong,
      p_revision: 3, p_request_id: uuid(), p_controller_token: token,
    });
    await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId, p_question_id: q.id, p_option_id: keyMap[q.id],
      p_revision: 4, p_request_id: uuid(), p_controller_token: token,
    });
    const { data } = await service.from('attempt_answers').select('selected_option_id,revision').eq('attempt_id', attemptId).eq('question_id', q.id).single();
    assertEquals(data.selected_option_id, keyMap[q.id], 'latest option persisted');
    assertEquals(Number(data.revision), 4, 'latest revision persisted');
  });
  await runner.check('out-of-order answer responses cannot replace the newest choice', async () => {
    const q = answerable[1];
    const wrong = q.options.find((option) => option.id !== keyMap[q.id]).id;
    await Promise.all([
      studentUC.rpc('save_answer', { p_attempt_id: attemptId, p_question_id: q.id, p_option_id: wrong, p_revision: 6, p_request_id: uuid(), p_controller_token: token }),
      studentUC.rpc('save_answer', { p_attempt_id: attemptId, p_question_id: q.id, p_option_id: keyMap[q.id], p_revision: 8, p_request_id: uuid(), p_controller_token: token }),
      studentUC.rpc('save_answer', { p_attempt_id: attemptId, p_question_id: q.id, p_option_id: wrong, p_revision: 7, p_request_id: uuid(), p_controller_token: token }),
    ]);
    const { data } = await service.from('attempt_answers').select('selected_option_id,revision').eq('attempt_id', attemptId).eq('question_id', q.id).single();
    assertEquals(data.selected_option_id, keyMap[q.id], 'revision 8 option retained');
    assertEquals(Number(data.revision), 8, 'highest revision retained');
  });
  await runner.check('cleared answer remains unanswered after payload reload', async () => {
    const q = payload.questions[30];
    await studentUC.rpc('save_answer', { p_attempt_id: attemptId, p_question_id: q.id, p_option_id: q.options[0].id, p_revision: 1, p_request_id: uuid(), p_controller_token: token });
    await studentUC.rpc('save_answer', { p_attempt_id: attemptId, p_question_id: q.id, p_option_id: null, p_revision: 2, p_request_id: uuid(), p_controller_token: token });
    const { data, error } = await studentUC.rpc('get_attempt_payload', { p_attempt_id: attemptId });
    assertNoError(error, 'payload after clear');
    const reloaded = data.questions.find((question) => question.id === q.id);
    assertEquals(reloaded.saved_option_id, null, 'clear persisted');
    assertEquals(Number(reloaded.revision), 2, 'clear revision persisted');
  });
  await runner.check('bookmarks persist per attempt without affecting answers', async () => {
    const q = payload.questions[4];
    const marked = await studentUC.rpc('toggle_bookmark', {
      p_attempt_id: attemptId, p_question_id: q.id, p_controller_token: token,
    });
    assertNoError(marked.error, 'mark bookmark');
    assertEquals(marked.data.bookmarked, true, 'marked');
    const loaded = await studentUC.rpc('get_bookmarks', {
      p_attempt_id: attemptId, p_controller_token: token,
    });
    assertNoError(loaded.error, 'load bookmarks');
    assert(loaded.data.bookmarks.includes(q.id), 'bookmark persisted');
    const unmarked = await studentUC.rpc('toggle_bookmark', {
      p_attempt_id: attemptId, p_question_id: q.id, p_controller_token: token,
    });
    assertEquals(unmarked.data.bookmarked, false, 'unmarked');
  });
  await runner.check('foreign controller token is rejected', async () => {
    const q = answerable[2];
    const { data } = await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: keyMap[q.id],
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: uuid(),
    });
    assertEquals(data.reason, 'controller', 'controller mismatch reported');
  });
  await runner.check('invalid option id is rejected', async () => {
    const q = answerable[3];
    const { data } = await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: q.id,
      p_option_id: uuid(),
      p_revision: 1,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    assertEquals(data.reason, 'invalid_option', 'invalid option reported');
  });

  // --- Violations: warning then atomic finalize (acceptance 9-11) ---------
  const episode1 = uuid();
  const signals = ['focus_lost', 'visibility_hidden', 'fullscreen_exit'];
  await runner.check('first distinct departure is one warning', async () => {
    const { data, error } = await studentUC.rpc('record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: episode1,
      p_signals: signals,
      p_observed_at: new Date().toISOString(),
      p_controller_token: token,
    });
    assertNoError(error, 'record_violation #1');
    assertEquals(data.violation_count, 1, 'one count');
    assertEquals(data.finalized, false, 'not finalized');
  });
  await runner.check('replayed tail signals do not double count', async () => {
    const { data, error } = await studentUC.rpc('record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: episode1,
      p_signals: ['visibility_hidden'],
      p_observed_at: new Date().toISOString(),
      p_controller_token: token,
    });
    assertNoError(error, 'record_violation duplicate');
    assertEquals(data.duplicate, true, 'duplicate flagged');
    assertEquals(data.violation_count, 1, 'still one count');
  });
  await runner.check('second distinct departure finalizes the attempt', async () => {
    const { data, error } = await studentUC.rpc('record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: uuid(),
      p_signals: signals,
      p_observed_at: new Date().toISOString(),
      p_controller_token: token,
    });
    assertNoError(error, 'record_violation #2');
    assertEquals(data.violation_count, 2, 'two counts');
    assertEquals(data.finalized, true, 'finalized');
    assertEquals(data.attempt_state, 'submitted', 'state submitted');
    assertEquals(data.submission_reason, 'violation_limit', 'reason violation_limit');
  });

  // --- Final, immutable score (acceptance 12-17) --------------------------
  await runner.check('final score reflects only server-saved answers', async () => {
    const { data, error } = await studentUC.rpc('get_result', { p_attempt_id: attemptId });
    assertNoError(error, 'get_result student');
    assertEquals(data.attempt_state, 'submitted', 'submitted');
    assertEquals(data.submission_reason, 'violation_limit', 'reason');
    assertEquals(data.answered_count, 30, 'answered 30');
    assertEquals(data.correct_count, 30, 'all 30 correct');
    assertEquals(Number(data.earned_points), 30, 'earned 30');
    assertEquals(Number(data.max_points), 50, 'max 50');
    assertEquals(Number(data.percentage), 60, 'percentage 60');
    assertEquals(data.released, true, 'immediate release');
  });
  await runner.check('answer review matches the exact option used for grading', async () => {
    const { data, error } = await studentUC.rpc('get_attempt_review', { p_attempt_id: attemptId });
    assertNoError(error, 'get_attempt_review mapping');
    const reviewed = data.questions.find((question) => question.id === answerable[0].id);
    assertEquals(reviewed.selected_option_id, keyMap[answerable[0].id], 'reviewed selection');
    assertEquals(reviewed.correct_option_id, keyMap[answerable[0].id], 'graded key');
    assertEquals(reviewed.is_correct, true, 'review grading');
  });
  await runner.check('answers cannot be changed after finalize', async () => {
    const { data } = await studentUC.rpc('save_answer', {
      p_attempt_id: attemptId,
      p_question_id: answerable[0].id,
      p_option_id: keyMap[answerable[0].id],
      p_revision: 99,
      p_request_id: uuid(),
      p_controller_token: token,
    });
    assertEquals(data.reason, 'finalized', 'finalized');
  });
  await runner.check('re-reporting a violation after finalize is a no-op', async () => {
    const { data, error } = await studentUC.rpc('record_violation', {
      p_attempt_id: attemptId,
      p_episode_id: uuid(),
      p_signals: signals,
      p_observed_at: new Date().toISOString(),
      p_controller_token: token,
    });
    assertNoError(error, 'post-finalize violation');
    assertEquals(data.finalized, true, 'still finalized');
    assertEquals(data.violation_count, 2, 'count unchanged');
  });
  await runner.check('duplicate submit returns the same final result', async () => {
    const { data, error } = await studentUC.rpc('submit_attempt', {
      p_attempt_id: attemptId,
      p_controller_token: token,
    });
    assertNoError(error, 'submit after finalize');
    assertEquals(data.attempt_state, 'submitted', 'submitted');
    assertEquals(Number(data.earned_points), 30, 'score unchanged');
  });
  await runner.check('student cannot forge final fields via direct update', async () => {
    const { error } = await studentUC
      .from('exam_attempts')
      .update({ earned_points: 100, state: 'in_progress' })
      .eq('id', attemptId);
    assert(error, 'direct update must be denied');
  });
  await runner.check('owner teacher can read the result; peer student cannot', async () => {
    const { error: ownerErr } = await teacherAC.rpc('get_result', { p_attempt_id: attemptId });
    assertNoError(ownerErr, 'teacher get_result');
    const { error: peerErr } = await studentXC.rpc('get_result', { p_attempt_id: attemptId });
    assert(peerErr, 'peer must not read the result');
  });

  // --- Server deadline precedence + release policy (acceptance 18, 21) ----
  await runner.check('result_release=after_close hides score until close', async () => {
    const payload = buildExamPayload({
      courseId,
      title: 'After Close Exam',
      questionCount: 5,
      resultRelease: 'after_close',
      closesInMs: 60 * 60 * 1000,
    });
    const { data: savedId, error: saveErr } = await teacherAC.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: payload,
    });
    assertNoError(saveErr, 'save after_close exam');
    fixture.exams.afterClose = savedId;
    const { data: vid, error: pubErr } = await teacherAC.rpc('publish_exam', { p_exam_id: savedId });
    assertNoError(pubErr, 'publish after_close exam');

    // student-p is still pending on the main course: approve just for this check.
    const { data: req } = await studentPC.rpc('request_enrollment', { p_join_code: joinCode });
    await teacherAC.rpc('decide_enrollment', { p_enrollment_id: req.enrollment_id, p_decision: 'approved' });

    const { data: started, error: startErr } = await studentPC.rpc('start_attempt', { p_exam_id: savedId });
    assertNoError(startErr, 'start after_close exam');
    const keyMap2 = await fetchKeyMap(service, vid);
    const p2 = (await studentPC.rpc('get_attempt_payload', { p_attempt_id: started.attempt_id })).data;
    for (const q of p2.questions) {
      await studentPC.rpc('save_answer', {
        p_attempt_id: started.attempt_id,
        p_question_id: q.id,
        p_option_id: keyMap2[q.id],
        p_revision: 1,
        p_request_id: uuid(),
        p_controller_token: started.controller_token,
      });
    }
    const { data: result, error: resErr } = await studentPC.rpc('submit_attempt', {
      p_attempt_id: started.attempt_id,
      p_controller_token: started.controller_token,
    });
    assertNoError(resErr, 'submit after_close exam');
    assertEquals(result.attempt_state, 'submitted', 'submitted');
    assertEquals(result.released, false, 'score withheld before close');
    assertEquals(result.earned_points, null, 'earned hidden');
    assertEquals(result.percentage, null, 'percentage hidden');
  });
  await runner.check('scheduled score and answer release boundaries are server-enforced', async () => {
    const resultAt = new Date(Date.now() + 1800).toISOString();
    const answerAt = new Date(Date.now() + 3200).toISOString();
    const scheduled = buildExamPayload({
      courseId,
      title: 'Scheduled Release Exam',
      questionCount: 5,
      resultRelease: 'scheduled',
      resultReleaseAt: resultAt,
      answerReview: 'scheduled',
      answerReleaseAt: answerAt,
    });
    const saved = await teacherAC.rpc('save_exam_draft', { p_exam_id: null, p_payload: scheduled });
    assertNoError(saved.error, 'save scheduled exam');
    fixture.exams.scheduled = saved.data;
    const published = await teacherAC.rpc('publish_exam', { p_exam_id: saved.data });
    assertNoError(published.error, 'publish scheduled exam');
    const started = await studentPC.rpc('start_attempt', { p_exam_id: saved.data });
    assertNoError(started.error, 'start scheduled exam');
    const submitted = await studentPC.rpc('submit_attempt', {
      p_attempt_id: started.data.attempt_id,
      p_controller_token: started.data.controller_token,
    });
    assertNoError(submitted.error, 'submit scheduled exam');
    assertEquals(submitted.data.released, false, 'score hidden before schedule');
    const direct = await studentPC.from('exam_attempts').select('id,percentage').eq('id', started.data.attempt_id);
    assertNoError(direct.error, 'direct scheduled attempt query');
    assertEquals(direct.data.length, 0, 'direct row hidden before release');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const score = await studentPC.rpc('get_result', { p_attempt_id: started.data.attempt_id });
    assertNoError(score.error, 'scheduled result after release');
    assertEquals(score.data.released, true, 'score released at schedule');
    assertEquals(score.data.review_released, false, 'answers remain hidden until answer schedule');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const review = await studentPC.rpc('get_attempt_review', { p_attempt_id: started.data.attempt_id });
    assertNoError(review.error, 'scheduled review after release');
    assertEquals(review.data.review_released, true, 'answers released at schedule');
  });
  await runner.check('passed server deadline forces time_expired over manual', async () => {
    const payload = buildExamPayload({ courseId, title: 'Deadline Exam', questionCount: 3 });
    const { data: savedId } = await teacherAC.rpc('save_exam_draft', { p_exam_id: null, p_payload: payload });
    fixture.exams.deadline = savedId;
    await teacherAC.rpc('publish_exam', { p_exam_id: savedId });
    const { data: started } = await studentUC.rpc('start_attempt', { p_exam_id: savedId });
    // Force the deadline into the past from the trusted side, then submit.
    await service
      .from('exam_attempts')
      .update({ deadline_at: new Date(Date.now() - 5000).toISOString() })
      .eq('id', started.attempt_id);
    const { data, error } = await studentUC.rpc('submit_attempt', {
      p_attempt_id: started.attempt_id,
      p_controller_token: started.controller_token,
    });
    assertNoError(error, 'submit past deadline');
    assertEquals(data.submission_reason, 'time_expired', 'deadline precedence');
  });

  // --- Teacher course management (join code, edit, archive, delete) -------
  await runner.check('owner retrieves the current join code; peer teacher is denied', async () => {
    const { data, error } = await teacherAC.rpc('get_join_code', { p_course_id: courseId });
    assertNoError(error, 'get_join_code owner');
    assertEquals(data.present, true, 'code present');
    assertEquals(data.code, joinCode, 'returns the active code');
    await assertRpcError(
      await teacherBC.rpc('get_join_code', { p_course_id: courseId }),
      'peer get_join_code',
    );
  });
  await runner.check('teacher updates course details', async () => {
    const { error } = await teacherAC.rpc('update_course', {
      p_course_id: courseId,
      p_title: 'Workflow Course (updated)',
      p_description: 'Updated description',
      p_section: 'B',
      p_academic_term: '2027',
    });
    assertNoError(error, 'update_course');
    const { data } = await service
      .from('courses')
      .select('title,section,academic_term,description')
      .eq('id', courseId)
      .single();
    assertEquals(data.title, 'Workflow Course (updated)', 'title updated');
    assertEquals(data.section, 'B', 'section updated');
    assertEquals(data.academic_term, '2027', 'term updated');
  });
  await runner.check('archiving a course blocks new attempts, restoring re-enables them', async () => {
    const { error } = await teacherAC.rpc('set_course_archived', {
      p_course_id: courseId,
      p_archived: true,
    });
    assertNoError(error, 'set_course_archived true');
    const { error: startErr } = await studentUC.rpc('start_attempt', { p_exam_id: examId });
    assert(startErr, 'archived course blocks a new attempt');
    const { error: restoreErr } = await teacherAC.rpc('set_course_archived', {
      p_course_id: courseId,
      p_archived: false,
    });
    assertNoError(restoreErr, 'set_course_archived false');
  });
  await runner.check('delete_course refuses a populated course but removes an empty one', async () => {
    await assertRpcError(
      await teacherAC.rpc('delete_course', { p_course_id: courseId }),
      'delete populated course',
    );
    const { data: empty, error: createErr } = await teacherAC.rpc('create_course', {
      p_title: 'Disposable Course',
      p_description: '',
      p_section: '',
      p_academic_term: '',
      p_course_code: `DEL${run.toUpperCase().slice(0, 6)}`.slice(0, 12),
    });
    assertNoError(createErr, 'create disposable course');
    const { error: delErr } = await teacherAC.rpc('delete_course', {
      p_course_id: empty.course_id,
    });
    assertNoError(delErr, 'delete empty course');
    const { data: gone } = await service.from('courses').select('id').eq('id', empty.course_id);
    assertEquals((gone ?? []).length, 0, 'empty course removed');
  });

  // --- Teacher-configurable attempts + result policy ----------------------
  await runner.check('teacher raises max_attempts and sets highest-score policy', async () => {
    const { error } = await teacherAC.rpc('update_exam_settings', {
      p_exam_id: examId,
      p_title: 'Workflow Exam',
      p_instructions: 'Two attempts allowed; highest score counts.',
      p_opens_at: new Date(Date.now() - 60_000).toISOString(),
      p_closes_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      p_duration_minutes: 60,
      p_result_release: 'immediate',
      p_max_attempts: 2,
      p_result_policy: 'highest',
      p_answer_review: 'immediate',
      p_pass_threshold: null,
    });
    assertNoError(error, 'update_exam_settings');
    const { data } = await service
      .from('exams')
      .select('max_attempts,result_policy,instructions,current_version_id')
      .eq('id', examId)
      .single();
    assertEquals(data.max_attempts, 2, 'max_attempts persisted');
    assertEquals(data.result_policy, 'highest', 'result_policy persisted');
    assertEquals(data.instructions, 'Two attempts allowed; highest score counts.', 'instructions persisted');
    assertEquals(data.current_version_id, versionId, 'published version unchanged');
  });
  await runner.check('archived exam rejects settings edits until restored', async () => {
    await teacherAC.rpc('archive_exam', { p_exam_id: examId });
    const { error } = await teacherAC.rpc('update_exam_settings', {
      p_exam_id: examId,
      p_title: 'Workflow Exam',
      p_instructions: 'nope',
      p_opens_at: new Date(Date.now() - 60_000).toISOString(),
      p_closes_at: new Date(Date.now() + 60_000).toISOString(),
      p_duration_minutes: 60,
      p_result_release: 'immediate',
      p_max_attempts: 2,
      p_result_policy: 'highest',
      p_answer_review: 'immediate',
      p_pass_threshold: null,
    });
    assert(error, 'archived exam must reject settings edits');
    await teacherAC.rpc('restore_exam', { p_exam_id: examId });
  });
  await runner.check('get_my_exam_attempts reports usage and remaining attempts', async () => {
    const { data, error } = await studentUC.rpc('get_my_exam_attempts', { p_exam_id: examId });
    assertNoError(error, 'get_my_exam_attempts');
    assertEquals(data.max_attempts, 2, 'max 2');
    assertEquals(data.used, 1, 'one attempt used');
    assertEquals(data.remaining, 1, 'one remaining');
    assertEquals(data.result_policy, 'highest', 'policy highest');
    assertEquals(data.attempts.length, 1, 'one attempt listed');
    assertEquals(data.attempts[0].attempt_no, 1, 'attempt_no 1');
    assertEquals(data.attempts[0].released, true, 'immediate release');
    assertEquals(Number(data.attempts[0].percentage), 60, 'first attempt percentage');
  });
  await runner.check('second attempt is numbered and permitted', async () => {
    const { data, error } = await studentUC.rpc('start_attempt', { p_exam_id: examId });
    assertNoError(error, 'start attempt 2');
    assertEquals(data.attempt_no, 2, 'attempt_no 2');
    assertEquals(data.max_attempts, 2, 'max reported');
    const { error: subErr } = await studentUC.rpc('submit_attempt', {
      p_attempt_id: data.attempt_id,
      p_controller_token: data.controller_token,
    });
    assertNoError(subErr, 'submit attempt 2');
  });
  await runner.check('a third start is blocked once attempts are exhausted', async () => {
    const { error } = await studentUC.rpc('start_attempt', { p_exam_id: examId });
    assert(error, 'third attempt blocked');
    assert(/(?:\b2 attempts\b|no attempts remaining)/i.test(error.message), 'attempt-limit message');
  });
  await runner.check('highest-score policy reports the best attempt', async () => {
    const { data, error } = await studentUC.rpc('get_my_exam_attempts', { p_exam_id: examId });
    assertNoError(error, 'get_my_exam_attempts after 2');
    assertEquals(data.used, 2, 'two used');
    assertEquals(data.remaining, 0, 'none remaining');
    assert(data.summary, 'summary present');
    assertEquals(data.summary.attempt_no, 1, 'highest score is attempt 1');
    assertEquals(Number(data.summary.percentage), 60, 'highest percentage');
  });
  await runner.check('get_my_results lists attempts and withholds unreleased scores', async () => {
    const { data, error } = await studentUC.rpc('get_my_results');
    assertNoError(error, 'get_my_results student-u');
    assert(Array.isArray(data) && data.length >= 1, 'attempts listed');
    const first = data.find((r) => r.exam_id === examId && r.attempt_no === 1);
    assert(first, 'attempt 1 present');
    assertEquals(first.released, true, 'attempt 1 released');
    assertEquals(Number(first.percentage), 60, 'attempt 1 percentage');

    const { data: pRows, error: pErr } = await studentPC.rpc('get_my_results');
    assertNoError(pErr, 'get_my_results student-p');
    const afterClose = (pRows ?? []).find((r) => r.exam_id === fixture.exams.afterClose);
    assert(afterClose, 'after_close attempt present');
    assertEquals(afterClose.released, false, 'after_close withheld');
    assertEquals(afterClose.earned_points, null, 'after_close score hidden');
  });
  await runner.check('unreleased score columns are inaccessible by direct table API', async () => {
    const { data, error } = await studentPC
      .from('exam_attempts')
      .select('id,earned_points,percentage,correct_count')
      .eq('exam_id', fixture.exams.afterClose);
    assertNoError(error, 'direct unreleased attempt query');
    assertEquals(data.length, 0, 'unreleased attempt row hidden');
  });
  await runner.check('get_my_results_page paginates and searches server-side', async () => {
    const { data: firstPage, error: firstErr } = await studentUC.rpc('get_my_results_page', {
      p_search: 'Workflow Exam',
      p_page: 1,
      p_page_size: 1,
    });
    assertNoError(firstErr, 'get_my_results_page page 1');
    assertEquals(firstPage.page, 1, 'page echoed');
    assertEquals(firstPage.page_size, 1, 'page size echoed');
    assert(firstPage.total >= 2, 'both attempts counted');
    assertEquals(firstPage.rows.length, 1, 'one row per page');

    const { data: secondPage, error: secondErr } = await studentUC.rpc('get_my_results_page', {
      p_search: 'Workflow Exam',
      p_page: 2,
      p_page_size: 1,
    });
    assertNoError(secondErr, 'get_my_results_page page 2');
    assertEquals(secondPage.total, firstPage.total, 'stable total');
    assertEquals(secondPage.rows.length, 1, 'second row');
    assert(secondPage.rows[0].id !== firstPage.rows[0].id, 'pages do not overlap');

    const { data: empty, error: emptyErr } = await studentUC.rpc('get_my_results_page', {
      p_search: 'no-such-exam-title',
      p_page: 1,
      p_page_size: 10,
    });
    assertNoError(emptyErr, 'get_my_results_page empty search');
    assertEquals(empty.total, 0, 'no matches');
    assertEquals(empty.rows.length, 0, 'no rows');

    const { data: pPage, error: pPageErr } = await studentPC.rpc('get_my_results_page', {
      p_search: 'After-close',
      p_page: 1,
      p_page_size: 10,
    });
    assertNoError(pPageErr, 'get_my_results_page student-p');
    const withheld = (pPage.rows ?? []).find((r) => r.exam_id === fixture.exams.afterClose);
    if (withheld) {
      assertEquals(withheld.released, false, 'page withholds after_close');
      assertEquals(withheld.earned_points, null, 'page hides after_close score');
    }
  });
  await runner.check('duplicating a published exam yields a fresh draft', async () => {
    const { data: dupId, error } = await teacherAC.rpc('duplicate_exam', { p_exam_id: examId });
    assertNoError(error, 'duplicate_exam');
    const { data } = await service
      .from('exams')
      .select('state,current_version_id,max_attempts,result_policy')
      .eq('id', dupId)
      .single();
    assertEquals(data.state, 'draft', 'copy is a draft');
    assertEquals(data.current_version_id, null, 'copy has no version');
    assertEquals(data.max_attempts, 2, 'settings copied');
    assertEquals(data.result_policy, 'highest', 'policy copied');
    const { data: qs } = await service.from('exam_questions').select('id').eq('exam_id', dupId);
    assertEquals((qs ?? []).length, 50, '50 questions copied');
    const { error: delErr } = await teacherAC.rpc('delete_exam', { p_exam_id: dupId });
    assertNoError(delErr, 'delete duplicated draft');
  });
  await runner.check('published exams cannot be deleted; drafts can', async () => {
    await assertRpcError(
      await teacherAC.rpc('delete_exam', { p_exam_id: examId }),
      'delete published exam',
    );
  });

  // --- Answer review gating, pass/fail threshold --------------------------
  async function authorExam(title, opts = {}) {
    const payload = buildExamPayload({ courseId, title, ...opts });
    const { data: savedId, error: saveErr } = await teacherAC.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: payload,
    });
    assertNoError(saveErr, `save ${title}`);
    fixture.exams[title] = savedId;
    const { data: vid, error: pubErr } = await teacherAC.rpc('publish_exam', { p_exam_id: savedId });
    assertNoError(pubErr, `publish ${title}`);
    return { examId: savedId, versionId: vid };
  }

  async function completeAttempt(client, examId, versionId, { answerCount } = {}) {
    const { data: started, error: startErr } = await client.rpc('start_attempt', {
      p_exam_id: examId,
    });
    assertNoError(startErr, 'start attempt');
    const keyMap = await fetchKeyMap(service, versionId);
    const { data: pay, error: payErr } = await client.rpc('get_attempt_payload', {
      p_attempt_id: started.attempt_id,
    });
    assertNoError(payErr, 'get_attempt_payload');
    const questions = answerCount === undefined ? pay.questions : pay.questions.slice(0, answerCount);
    for (const q of questions) {
      await client.rpc('save_answer', {
        p_attempt_id: started.attempt_id,
        p_question_id: q.id,
        p_option_id: keyMap[q.id],
        p_revision: 1,
        p_request_id: uuid(),
        p_controller_token: started.controller_token,
      });
    }
    const { data: result, error: subErr } = await client.rpc('submit_attempt', {
      p_attempt_id: started.attempt_id,
      p_controller_token: started.controller_token,
    });
    assertNoError(subErr, 'submit attempt');
    return { attemptId: started.attempt_id, token: started.controller_token, result };
  }

  await runner.check('immediate answer review exposes per-question detail to the owning student', async () => {
    const { data, error } = await studentUC.rpc('get_attempt_review', { p_attempt_id: attemptId });
    assertNoError(error, 'student get_attempt_review');
    assertEquals(data.review_released, true, 'review released');
    assertEquals(data.review_reason, 'immediate', 'reason immediate');
    assertEquals(data.questions.length, 50, 'all questions present');
    const first = data.questions[0];
    assert(first.correct_option_id, 'correct option id revealed once released');
    assert('selected_option_id' in first, 'selected option present');
    assert('is_correct' in first, 'graded outcome present');
    assert(first.options.length >= 2, 'options returned in shown order');
  });
  await runner.check('the owning teacher may read the attempt review', async () => {
    const { data, error } = await teacherAC.rpc('get_attempt_review', { p_attempt_id: attemptId });
    assertNoError(error, 'teacher get_attempt_review');
    assertEquals(data.review_released, true, 'teacher review released');
    assertEquals(data.review_reason, 'privileged', 'privileged reason');
  });
  await runner.check('a peer student cannot read another attempt review', async () => {
    await assertRpcError(
      await studentXC.rpc('get_attempt_review', { p_attempt_id: attemptId }),
      'peer get_attempt_review',
    );
  });
  await runner.check('a "never" review policy withholds all key material', async () => {
    const exam = await authorExam('Never Review', { questionCount: 4, answerReview: 'never' });
    const attempted = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 4 });
    const { data: rev, error } = await studentPC.rpc('get_attempt_review', {
      p_attempt_id: attempted.attemptId,
    });
    assertNoError(error, 'get_attempt_review never');
    assertEquals(rev.review_released, false, 'review withheld');
    assertEquals(rev.review_reason, 'never', 'reason never');
    assertEquals(rev.questions.length, 0, 'no questions leaked');
    const blob = JSON.stringify(rev).toLowerCase();
    assert(!blob.includes('correct_option_id'), 'no correct answers in payload');
    assert(!blob.includes('"correct_index"'), 'no correct index in payload');
    const { data: res } = await studentPC.rpc('get_result', { p_attempt_id: attempted.attemptId });
    assertEquals(res.review_released, false, 'result reports review withheld');
  });
  await runner.check('an "after_close" review stays hidden while the exam is open', async () => {
    const exam = await authorExam('After Close Review', {
      questionCount: 4,
      resultRelease: 'immediate',
      answerReview: 'after_close',
      closesInMs: 60 * 60 * 1000,
    });
    const attempted = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 4 });
    assertEquals(attempted.result.released, true, 'score released immediately');
    const { data: rev, error } = await studentPC.rpc('get_attempt_review', {
      p_attempt_id: attempted.attemptId,
    });
    assertNoError(error, 'get_attempt_review after_close');
    assertEquals(rev.review_released, false, 'review withheld until close');
    assertEquals(rev.review_reason, 'awaiting_close', 'reason awaiting_close');
    assertEquals(rev.questions.length, 0, 'no questions before close');
  });
  await runner.check('an "after_attempts" review releases only once attempts are exhausted', async () => {
    const exam = await authorExam('After Attempts Review', {
      questionCount: 4,
      answerReview: 'after_attempts',
      maxAttempts: 2,
    });
    const first = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 4 });
    const { data: rev1 } = await studentPC.rpc('get_attempt_review', { p_attempt_id: first.attemptId });
    assertEquals(rev1.review_released, false, 'withheld after first attempt');
    assertEquals(rev1.review_reason, 'awaiting_attempts', 'awaiting more attempts');

    const second = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 4 });
    const { data: rev2, error } = await studentPC.rpc('get_attempt_review', {
      p_attempt_id: second.attemptId,
    });
    assertNoError(error, 'get_attempt_review after_attempts');
    assertEquals(rev2.review_released, true, 'released after final attempt');
    assertEquals(rev2.review_reason, 'after_attempts', 'reason after_attempts');
    assertEquals(rev2.questions.length, 4, 'questions revealed');
  });
  await runner.check('pass threshold marks a below-threshold attempt as failed', async () => {
    const exam = await authorExam('Pass Threshold Fail', {
      questionCount: 4,
      passThreshold: 80,
    });
    const attempted = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 1 });
    const { data: res, error } = await studentPC.rpc('get_result', {
      p_attempt_id: attempted.attemptId,
    });
    assertNoError(error, 'get_result pass-threshold');
    assertEquals(Number(res.pass_threshold), 80, 'threshold surfaced');
    assertEquals(Number(res.percentage), 25, 'one of four correct');
    assertEquals(res.passed, false, 'below threshold fails');
    const { data: rows } = await studentPC.rpc('get_my_results');
    const row = (rows ?? []).find((r) => r.id === attempted.attemptId);
    assert(row, 'attempt listed');
    assertEquals(row.pass_threshold !== null, true, 'history exposes threshold');
    assertEquals(row.passed, false, 'history marks failed');
  });
  await runner.check('pass threshold marks a meeting attempt as passed', async () => {
    const exam = await authorExam('Pass Threshold Pass', {
      questionCount: 4,
      passThreshold: 40,
    });
    const attempted = await completeAttempt(studentPC, exam.examId, exam.versionId, { answerCount: 4 });
    const { data: res, error } = await studentPC.rpc('get_result', {
      p_attempt_id: attempted.attemptId,
    });
    assertNoError(error, 'get_result pass');
    assertEquals(Number(res.percentage), 100, 'all correct');
    assertEquals(res.passed, true, 'at/above threshold passes');
  });

  const state = runner.report();
  fixture.attempts = { main: attemptId };
  const manifest = saveManifest(`workflow-${run}`, fixture);
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
  console.error('Workflow verification aborted:', err.message);
  process.exit(1);
});
