#!/usr/bin/env node
import { requireConfig, serviceClient, signIn, buildExamPayload } from './lib/harness.mjs';
import { randomUUID } from 'node:crypto';

const cfg = requireConfig({ service: true });
const service = serviceClient(cfg);
const password = process.env.SEED_PASSWORD ?? 'ExamDemo!234';
let passed = 0;
let failed = 0;
const created = [];
let draftExamId = null;
let suspendedTeacherId = null;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function submitArgs(overrides = {}) {
  return {
    p_category: 'suggestion',
    p_subject: 'Feedback verification',
    p_message: 'This is an isolated duplicate-submit verification message.',
    p_rating: 4,
    p_course_id: null,
    p_exam_id: null,
    p_question_id: null,
    p_recipient_type: 'administration',
    p_request_id: randomUUID(),
    ...overrides,
  };
}

async function main() {
  const student = await signIn(cfg, 'student1@exam.test', password);
  const otherStudent = await signIn(cfg, 'student2@exam.test', password);
  const teacher = await signIn(cfg, 'teacher1@exam.test', password);
  const peerTeacher = await signIn(cfg, 'teacher2@exam.test', password);
  const admin = await signIn(cfg, 'admin@exam.test', password);
  const { data: courses, error: courseError } = await teacher
    .from('courses')
    .select('id, owner_id')
    .eq('course_code', 'SOP101')
    .limit(1);
  if (courseError || !courses?.[0]) throw new Error('SOP101 fixture course is unavailable');
  const courseId = courses[0].id;
  const ownerTeacherId = courses[0].owner_id;

  const { data: published } = await service
    .from('exams')
    .select('id, state')
    .eq('course_id', courseId)
    .eq('state', 'published')
    .limit(1)
    .maybeSingle();
  const publishedExamId = published?.id ?? null;
  let questionId = null;
  if (publishedExamId) {
    const { data: question } = await service
      .from('exam_questions')
      .select('id')
      .eq('exam_id', publishedExamId)
      .limit(1)
      .maybeSingle();
    questionId = question?.id ?? null;
  }

  let duplicateId;

  await check('duplicate request id creates one administration submission', async () => {
    const args = submitArgs();
    const first = await student.rpc('submit_feedback', args);
    const second = await student.rpc('submit_feedback', args);
    if (first.error || second.error) throw first.error ?? second.error;
    assert(first.data === second.data, 'duplicate request returned a different record');
    duplicateId = first.data;
    created.push(first.data);
  });

  await check('repeated double-click returns the same recent submission', async () => {
    const first = await student.rpc('submit_feedback', submitArgs({
      p_subject: 'Double click verification',
      p_message: 'The same message submitted twice by a double click.',
    }));
    const second = await student.rpc('submit_feedback', submitArgs({
      p_subject: 'Double click verification',
      p_message: 'The same message submitted twice by a double click.',
    }));
    if (first.error || second.error) throw first.error ?? second.error;
    assert(first.data === second.data, 'double-click created two records');
    created.push(first.data);
  });

  await check('student submits authorized course feedback to the course teacher', async () => {
    const submitted = await student.rpc('submit_feedback', submitArgs({
      p_category: 'exam_concern',
      p_subject: 'Course-linked verification',
      p_message: 'This concern is linked to an authorized enrolled course.',
      p_rating: null,
      p_course_id: courseId,
      p_recipient_type: 'course_teacher',
    }));
    if (submitted.error) throw submitted.error;
    created.push(submitted.data);
    const own = await student.rpc('get_my_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (own.error) throw own.error;
    const row = own.data.rows.find((item) => item.id === submitted.data);
    assert(row, 'own submission missing');
    assert(row.recipient_type === 'course_teacher', 'recipient was not recorded');
    assert(row.recipient_teacher_name, 'teacher recipient name missing');
    assert(!('staff_notes' in row), 'private notes leaked in own endpoint');
  });

  await check('administration feedback with a linked course stays out of the teacher queue', async () => {
    const submitted = await student.rpc('submit_feedback', submitArgs({
      p_subject: 'Administration-only verification',
      p_message: 'This course-linked concern is addressed to administration only.',
      p_course_id: courseId,
      p_recipient_type: 'administration',
    }));
    if (submitted.error) throw submitted.error;
    created.push(submitted.data);
    const teacherPage = await teacher.rpc('get_staff_feedback_page', {
      p_search: 'Administration-only verification', p_status: '', p_page: 1, p_page_size: 10,
    });
    if (teacherPage.error) throw teacherPage.error;
    assert(
      !teacherPage.data.rows.some((row) => row.id === submitted.data),
      'teacher can read administration-addressed feedback',
    );
    const adminPage = await admin.rpc('get_staff_feedback_page', {
      p_search: 'Administration-only verification', p_status: '', p_page: 1, p_page_size: 10,
    });
    if (adminPage.error) throw adminPage.error;
    assert(
      adminPage.data.rows.some((row) => row.id === submitted.data),
      'administration inbox cannot see its feedback',
    );
  });

  await check('direct table access remains unavailable', async () => {
    const direct = await student.from('exam_feedback').select('*').eq('id', duplicateId);
    assert(direct.error, 'student unexpectedly has direct table access');
  });

  await check('owning teacher sees only feedback addressed to them', async () => {
    const own = await teacher.rpc('get_staff_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    const peer = await peerTeacher.rpc('get_staff_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (own.error || peer.error) throw own.error ?? peer.error;
    assert(own.data.rows.some((row) => row.id === created[2]), 'owner teacher cannot see addressed feedback');
    assert(!peer.data.rows.some((row) => row.id === created[2]), 'peer teacher can see another teacher\'s feedback');
  });

  await check('student cannot read another account\'s submissions', async () => {
    const page = await otherStudent.rpc('get_my_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (page.error) throw page.error;
    assert(page.data.rows.length === 0, 'another student can read the submission');
  });

  await check('private notes stay private while responses are unread/read', async () => {
    const linkedId = created[2];
    const updated = await teacher.rpc('update_feedback', {
      p_feedback_id: linkedId, p_status: 'in_review',
      p_staff_notes: 'private verification note', p_response: 'Visible verification response',
    });
    if (updated.error) throw updated.error;

    const own = await student.rpc('get_my_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (own.error) throw own.error;
    const row = own.data.rows.find((item) => item.id === linkedId);
    assert(row?.response === 'Visible verification response', 'visible response missing');
    assert(!('staff_notes' in row), 'private note leaked');
    assert(row.has_unread === true, 'student unread response indicator missing');

    const studentCounts = await student.rpc('get_feedback_unread_counts');
    if (studentCounts.error) throw studentCounts.error;
    assert(studentCounts.data.student_unread >= 1, 'student unread count missing');

    const read = await student.rpc('mark_my_feedback_read', { p_feedback_id: linkedId });
    if (read.error) throw read.error;
    const after = await student.rpc('get_my_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (after.error) throw after.error;
    assert(after.data.rows.find((item) => item.id === linkedId)?.has_unread === false, 'student read marker did not clear');
  });

  await check('staff unread filter and mark-read work', async () => {
    const fresh = await student.rpc('submit_feedback', submitArgs({
      p_subject: 'Staff unread verification',
      p_message: 'A fresh course-teacher submission used to verify unread state.',
      p_course_id: courseId,
      p_recipient_type: 'course_teacher',
    }));
    if (fresh.error) throw fresh.error;
    created.push(fresh.data);
    const linkedId = fresh.data;
    const before = await teacher.rpc('get_feedback_unread_counts');
    if (before.error) throw before.error;
    assert(before.data.staff_unread >= 1, 'teacher unread count missing before read');

    const unread = await teacher.rpc('get_staff_feedback_page', {
      p_search: '', p_status: '', p_recipient: '', p_unread_only: true, p_page: 1, p_page_size: 50,
    });
    if (unread.error) throw unread.error;
    assert(unread.data.rows.every((row) => row.has_unread), 'unread filter returned read rows');
    assert(unread.data.rows.some((row) => row.id === linkedId), 'new feedback missing from unread filter');

    const marked = await teacher.rpc('mark_feedback_read', { p_feedback_id: linkedId });
    if (marked.error) throw marked.error;
    const after = await teacher.rpc('get_feedback_unread_counts');
    if (after.error) throw after.error;
    assert(after.data.staff_unread < before.data.staff_unread, 'staff read marker did not reduce the count');
  });

  await check('recipient filter separates administration from course-teacher inboxes', async () => {
    const adminOnly = await admin.rpc('get_staff_feedback_page', {
      p_search: '', p_status: '', p_recipient: 'administration', p_page: 1, p_page_size: 50,
    });
    if (adminOnly.error) throw adminOnly.error;
    assert(adminOnly.data.rows.every((row) => row.recipient_type === 'administration'), 'recipient filter leaked teacher feedback');

    const teacherOnly = await teacher.rpc('get_staff_feedback_page', {
      p_search: '', p_status: '', p_recipient: 'course_teacher', p_page: 1, p_page_size: 50,
    });
    if (teacherOnly.error) throw teacherOnly.error;
    assert(teacherOnly.data.rows.every((row) => row.recipient_type === 'course_teacher'), 'teacher saw an administration row');
  });

  await check('a teacher cannot update feedback addressed to another teacher', async () => {
    const denied = await peerTeacher.rpc('update_feedback', {
      p_feedback_id: created[2], p_status: 'resolved', p_staff_notes: 'nope', p_response: 'nope',
    });
    assert(denied.error, 'peer teacher updated another teacher\'s feedback');
  });

  await check('a student cannot update staff fields', async () => {
    const denied = await student.rpc('update_feedback', {
      p_feedback_id: created[2], p_status: 'resolved', p_staff_notes: 'nope', p_response: 'nope',
    });
    assert(denied.error, 'student updated staff fields');
  });

  await check('staff notes and responses are length-limited', async () => {
    const denied = await teacher.rpc('update_feedback', {
      p_feedback_id: created[2], p_status: 'in_review',
      p_staff_notes: 'x'.repeat(5001), p_response: 'ok',
    });
    assert(denied.error, 'oversized staff note was accepted');
  });

  await check('a student cannot link a draft exam', async () => {
    const { data: createdExam, error } = await teacher.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: buildExamPayload({
        courseId,
        title: `Feedback draft ${Date.now()}`,
        questionCount: 1,
      }),
    });
    if (error) throw error;
    draftExamId = createdExam;
    const denied = await student.rpc('submit_feedback', submitArgs({
      p_subject: 'Draft exam verification',
      p_message: 'This submission should not be allowed against a draft exam.',
      p_course_id: courseId,
      p_exam_id: createdExam,
      p_recipient_type: 'course_teacher',
    }));
    assert(denied.error, 'student linked a draft exam');
  });

  await check('linked questions never return answer keys', async () => {
    if (!publishedExamId || !questionId) return;
    const submitted = await student.rpc('submit_feedback', submitArgs({
      p_category: 'exam_concern',
      p_subject: 'Question-linked verification',
      p_message: 'A question-linked concern used to verify the returned shape.',
      p_course_id: courseId,
      p_exam_id: publishedExamId,
      p_question_id: questionId,
      p_recipient_type: 'course_teacher',
    }));
    if (submitted.error) throw submitted.error;
    created.push(submitted.data);
    const page = await student.rpc('get_my_feedback_page', {
      p_search: 'Question-linked verification', p_status: '', p_page: 1, p_page_size: 10,
    });
    if (page.error) throw page.error;
    const row = page.data.rows.find((item) => item.id === submitted.data);
    assert(row, 'linked submission missing');
    const serialized = JSON.stringify(row).toLowerCase();
    assert(!serialized.includes('correct_option'), 'answer key field leaked');
    assert(!serialized.includes('answer_key'), 'answer key leaked');
    assert(!('correct_option_id' in row), 'correct option leaked');
  });

  await check('an unenrolled student cannot link a course', async () => {
    const denied = await otherStudent.rpc('submit_feedback', submitArgs({
      p_subject: 'Unauthorized course verification',
      p_message: 'An unenrolled student must not link this course.',
      p_course_id: courseId,
      p_recipient_type: 'course_teacher',
    }));
    assert(denied.error, 'unenrolled student linked a course');
  });

  await check('suspended staff cannot act through a still-valid session', async () => {
    const { data: profile } = await service
      .from('profiles').select('id').eq('email', 'teacher1@exam.test').single();
    suspendedTeacherId = profile?.id ?? ownerTeacherId;
    const suspend = await service
      .from('profiles').update({ status: 'suspended' }).eq('id', suspendedTeacherId);
    if (suspend.error) throw suspend.error;
    try {
      const denied = await teacher.rpc('update_feedback', {
        p_feedback_id: created[2], p_status: 'in_review', p_staff_notes: 'suspended', p_response: 'suspended',
      });
      assert(denied.error, 'suspended teacher updated feedback');
    } finally {
      const restore = await service
        .from('profiles').update({ status: 'active' }).eq('id', suspendedTeacherId);
      suspendedTeacherId = null;
      if (restore.error) throw restore.error;
    }
  });

  await check('administrator can manage all feedback', async () => {
    const page = await admin.rpc('get_staff_feedback_page', { p_search: 'Feedback verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (page.error) throw page.error;
    assert(page.data.rows.some((row) => row.id === duplicateId), 'general feedback absent from admin queue');
  });
}

try {
  await main();
} finally {
  if (suspendedTeacherId) {
    await service.from('profiles').update({ status: 'active' }).eq('id', suspendedTeacherId);
  }
  if (created.length) await service.from('exam_feedback').delete().in('id', created);
  if (draftExamId) await service.from('exams').delete().eq('id', draftExamId);
}

console.log(`\nfeedback: ${passed}/${passed + failed} checks passed.`);
process.exitCode = failed ? 1 : 0;
