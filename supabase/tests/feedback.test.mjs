#!/usr/bin/env node
import { requireConfig, serviceClient, signIn } from './lib/harness.mjs';
import { randomUUID } from 'node:crypto';

const cfg = requireConfig({ service: true });
const service = serviceClient(cfg);
const password = process.env.SEED_PASSWORD ?? 'ExamDemo!234';
let passed = 0;
let failed = 0;
const created = [];

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

async function main() {
  const student = await signIn(cfg, 'student1@exam.test', password);
  const teacher = await signIn(cfg, 'teacher1@exam.test', password);
  const peerTeacher = await signIn(cfg, 'teacher2@exam.test', password);
  const admin = await signIn(cfg, 'admin@exam.test', password);
  const { data: courses, error: courseError } = await teacher.from('courses').select('id').eq('course_code', 'SOP101').limit(1);
  if (courseError || !courses?.[0]) throw new Error('SOP101 fixture course is unavailable');
  const courseId = courses[0].id;
  const requestId = randomUUID();
  let linkedId;

  await check('duplicate request id creates one account-linked submission', async () => {
    const args = {
      p_category: 'suggestion', p_subject: 'Feedback verification',
      p_message: 'This is an isolated duplicate-submit verification message.',
      p_rating: 4, p_course_id: null, p_exam_id: null, p_question_id: null,
      p_request_id: requestId,
    };
    const first = await student.rpc('submit_feedback', args);
    const second = await student.rpc('submit_feedback', args);
    if (first.error || second.error) throw first.error ?? second.error;
    assert(first.data === second.data, 'duplicate request returned a different record');
    created.push(first.data);
  });

  await check('student submits authorized course feedback and sees own submission', async () => {
    const submitted = await student.rpc('submit_feedback', {
      p_category: 'exam_concern', p_subject: 'Course-linked verification',
      p_message: 'This concern is linked to an authorized enrolled course.',
      p_rating: null, p_course_id: courseId, p_exam_id: null, p_question_id: null,
      p_request_id: randomUUID(),
    });
    if (submitted.error) throw submitted.error;
    linkedId = submitted.data;
    created.push(linkedId);
    const own = await student.rpc('get_my_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (own.error) throw own.error;
    assert(own.data.rows.some((row) => row.id === linkedId), 'own submission missing');
    assert(!('staff_notes' in own.data.rows[0]), 'private notes leaked in own endpoint');
  });

  await check('direct table access remains unavailable', async () => {
    const direct = await student.from('exam_feedback').select('*').eq('id', linkedId);
    assert(direct.error, 'student unexpectedly has direct table access');
  });

  await check('owning teacher sees associated feedback but peer teacher does not', async () => {
    const own = await teacher.rpc('get_staff_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    const peer = await peerTeacher.rpc('get_staff_feedback_page', { p_search: 'Course-linked verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (own.error || peer.error) throw own.error ?? peer.error;
    assert(own.data.rows.some((row) => row.id === linkedId), 'owner teacher cannot see associated feedback');
    assert(!peer.data.rows.some((row) => row.id === linkedId), 'peer teacher can see unrelated feedback');
  });

  await check('private notes stay private while response is visible', async () => {
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
  });

  await check('administrator can manage all feedback', async () => {
    const page = await admin.rpc('get_staff_feedback_page', { p_search: 'Feedback verification', p_status: '', p_page: 1, p_page_size: 10 });
    if (page.error) throw page.error;
    assert(page.data.rows.some((row) => row.id === created[0]), 'general feedback absent from admin queue');
  });
}

try {
  await main();
} finally {
  if (created.length) await service.from('exam_feedback').delete().in('id', created);
}

console.log(`\nfeedback: ${passed}/${passed + failed} checks passed.`);
process.exitCode = failed ? 1 : 0;
