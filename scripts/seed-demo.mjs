#!/usr/bin/env node
/**
 * Idempotent demo-data seeder for the Exavyn platform.
 *
 * Uses the real application path (RPCs driven by real user sessions) so the
 * seeded course, enrollment, and 50-item published exam exercise the same
 * server functions the UI uses.
 *
 * ✅ These variables may be exported by the environment or read from .env.
 *
 * Required:
 *   SUPABASE_URL            Project URL
 *   SUPABASE_SERVICE_ROLE_KEY   Used ONLY here, never to the browser, to
 *                               create users/roles. Set via
 *                               `supabase secrets` for Edge Functions or kept
 *                               in a local, non-committed file.
 *   SUPABASE_ANON_KEY       Browser-safe key used to drive real user sessions.
 *
 * Optional:
 *   SEED_PASSWORD           Default password for every seeded account.
 *
 * Usage:
 *   node scripts/seed-demo.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { loadServerEnv } from './lib/load-env.mjs';

// Server-side script: read secrets from the gitignored `.env.server.local`
// (then browser-safe `.env.local` / `.env`). Real process env always wins.
loadServerEnv();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const password = process.env.SEED_PASSWORD ?? 'ExamDemo!234';

if (!url || !serviceKey) {
  console.error(
    'Aborting: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. ' +
      'See .env.example for guidance. This script is for developers only; ' +
      'service-role keys must never ship to a browser.',
  );
  process.exit(1);
}
if (!anonKey) {
  console.error('Aborting: SUPABASE_ANON_KEY is required.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const users = [
  { email: 'admin@exam.test', full_name: 'Platform Admin', role: 'admin' },
  { email: 'teacher1@exam.test', full_name: 'Teacher One', role: 'teacher' },
  { email: 'teacher2@exam.test', full_name: 'Teacher Two', role: 'teacher' },
  { email: 'student1@exam.test', full_name: 'Student One', role: 'student' },
  { email: 'student2@exam.test', full_name: 'Student Two', role: 'student' },
  { email: 'student3@exam.test', full_name: 'Student Three', role: 'student' },
];

async function ensureUser(email) {
  const { data: list } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });
  let user = list?.users?.find((u) => u.email === email);
  if (user) {
    await admin.auth.admin.updateUserById(user.id, { password });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`create ${email}: ${error.message}`);
    user = data.user;
  }
  return user.id;
}

async function upsertProfile(id, email, fullName) {
  const { error } = await admin
    .from('profiles')
    .upsert({ id, email, full_name: fullName, status: 'active' });
  if (error) throw new Error(`profile ${email}: ${error.message}`);
}

async function upsertRole(userId, role) {
  const { error } = await admin
    .from('user_roles')
    .upsert({ user_id: userId, role });
  if (error) throw new Error(`role ${role} ${userId}: ${error.message}`);
}

function signInClient() {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

async function signIn(client, email) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
}

function examPayload(courseId) {
  const questions = Array.from({ length: 50 }, (_, i) => {
    const correct = i % 4;
    return {
      prompt: `Question ${i + 1}: the capital of order ${i + 1} is?`,
      points: 1,
      options: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label) => ({ label })),
      correct_index: correct,
    };
  });
  const now = Date.now();
  return {
    course_id: courseId,
    title: 'Demo: Principles of Secure Assessment (50 items)',
    instructions:
      'This exam runs in fullscreen. Leaving the window is monitored. Two distinct ' +
      'departures finalise your attempt automatically.',
    duration_minutes: 60,
    opens_at: new Date(now - 60_000).toISOString(),
    closes_at: new Date(now + 7 * 86_400_000).toISOString(),
    question_randomization: true,
    option_randomization: true,
    result_release: 'after_close',
    questions,
  };
}

const DEMO_TITLE = 'Demo: Principles of Secure Assessment (50 items)';

async function run() {
  console.log(`Seeding against ${url}`);
  const userIds = {};
  for (const u of users) {
    const id = await ensureUser(u.email);
    userIds[u.email] = id;
    await upsertProfile(id, u.email, u.full_name);
    await upsertRole(id, u.role);
  }
  console.log('Users ensured (default password set for all):', password);

  // --- Teacher One owns the demo course (reused on re-runs) --------------
  const teacher1 = signInClient();
  await signIn(teacher1, 'teacher1@exam.test');
  const { data: existingCourse } = await admin
    .from('courses')
    .select('id')
    .eq('course_code', 'SOP101')
    .limit(1)
    .maybeSingle();
  let courseId = existingCourse?.id ?? null;
  let joinCode = null;
  if (courseId) {
    console.log('Reusing existing demo course', courseId);
  } else {
    const { data: created, error: courseErr } = await teacher1.rpc('create_course', {
      p_title: 'SOP 101 — Assessment Administration',
      p_description: 'Demo course for the anti-cheating exam walkthrough.',
      p_section: 'Section A',
      p_academic_term: '2026 Term 1',
      p_course_code: 'SOP101',
    });
    if (courseErr) throw new Error(`create_course: ${courseErr.message}`);
    courseId = created.course_id;
    joinCode = created.join_code;
    console.log('Teacher One created course', courseId, 'join code:', joinCode);
  }

  // --- Student One is enrolled + approved (real RPC path on first run) ----
  const student1 = signInClient();
  await signIn(student1, 'student1@exam.test');
  const { data: existingEnrollment } = await admin
    .from('enrollments')
    .select('status')
    .eq('course_id', courseId)
    .eq('student_id', userIds['student1@exam.test'])
    .maybeSingle();
  if (existingEnrollment?.status === 'approved') {
    console.log('Student One already enrolled/approved.');
  } else {
    const { data: req, error: reqErr } = await student1.rpc('request_enrollment', {
      p_join_code: joinCode,
    });
    if (reqErr) throw new Error(`request_enrollment: ${reqErr.message}`);
    const { error: decideErr } = await teacher1.rpc('decide_enrollment', {
      p_enrollment_id: req.enrollment_id,
      p_decision: 'approved',
    });
    if (decideErr) throw new Error(`decide_enrollment: ${decideErr.message}`);
    console.log('Student One enrolled and approved.');
  }

  // Student Three leaves a pending request for the approval workflow demo.
  const student3 = signInClient();
  await signIn(student3, 'student3@exam.test');
  const { data: s3Enroll } = await admin
    .from('enrollments')
    .select('status')
    .eq('course_id', courseId)
    .eq('student_id', userIds['student3@exam.test'])
    .maybeSingle();
  if (s3Enroll) {
    console.log(`Student Three enrollment already present (${s3Enroll.status}).`);
  } else if (joinCode) {
    await student3.rpc('request_enrollment', { p_join_code: joinCode });
    console.log('Student Three requested enrollment (pending).');
  } else {
    console.log('Student Three: join code unavailable on reuse; skipped.');
  }

  // --- Teacher One authors and publishes a 50-item exam (reused on re-runs) -
  const { data: existingExam } = await admin
    .from('exams')
    .select('id')
    .eq('course_id', courseId)
    .eq('state', 'published')
    .eq('title', DEMO_TITLE)
    .limit(1)
    .maybeSingle();
  let examId = existingExam?.id ?? null;
  if (examId) {
    console.log('Reusing existing published exam', examId);
  } else {
    const { data: createdExamId, error: saveErr } = await teacher1.rpc('save_exam_draft', {
      p_exam_id: null,
      p_payload: examPayload(courseId),
    });
    if (saveErr) throw new Error(`save_exam_draft: ${saveErr.message}`);
    examId = createdExamId;
    const { error: publishErr } = await teacher1.rpc('publish_exam', {
      p_exam_id: examId,
    });
    if (publishErr) throw new Error(`publish_exam: ${publishErr.message}`);
    console.log('Teacher One published 50-item exam', examId);
  }

  console.log('\nDemo data ready.');
  console.log('-------------------');
  console.log(`Admin:    admin@exam.test / ${password}    (sign in, then run bootstrap-admin)`);
  console.log(`Teachers: teacher1@exam.test, teacher2@exam.test`);
  console.log(`Students: student1@exam.test (enrolled/approved)`);
  console.log(`          student2@exam.test (not enrolled)`);
  console.log(`          student3@exam.test (enrollment pending)`);
  console.log(`Course:   ${courseId}${joinCode ? `   join code: ${joinCode}` : '   (existing)'}`);
  console.log(`Exam:     ${examId}`);
  console.log('\nNext: sign in as student1, open the course from the Student Dashboard,');
  console.log('and take the published exam. Trigger two distinct departures to confirm');
  console.log('Warning 1/2 and the immutable auto-finalised result.');
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});