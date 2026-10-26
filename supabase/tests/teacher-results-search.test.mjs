#!/usr/bin/env node
/**
 * Hosted teacher exam-results search verification.
 *
 * Creates an isolated teacher/course/exam with direct fixture attempts covering
 * literal wildcard characters, multiple attempts, both attempt states, and a
 * stable started_at tie. Exercises both search RPCs with real user tokens.
 * No existing user, enrollment, attempt, answer, or result is modified.
 */
import {
  anonClient,
  assert,
  assertNoError,
  assertRpcError,
  bestEffortCleanup,
  config,
  createRunner,
  createUser,
  reportLeftovers,
  requireConfig,
  serviceClient,
  setRole,
  shortId,
  signIn,
} from './lib/harness.mjs';

const cfg = requireConfig({ service: true });
const service = serviceClient(cfg);
const runner = createRunner('Teacher results search');

function page(result, context) {
  assertNoError(result.error, context);
  const data = result.data;
  assert(data && Array.isArray(data.rows), `${context}: expected rows array`);
  assert(typeof data.total === 'number', `${context}: expected numeric total`);
  return data;
}

function ids(data) {
  return data.rows.map((row) => row.id);
}

function compareAttempts(a, b) {
  const timeDiff = Date.parse(b.started_at) - Date.parse(a.started_at);
  if (timeDiff !== 0) return timeDiff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

async function main() {
  const run = shortId();
  const password = `Results-${run}-Aa1`;
  const email = (name) => `${name}.${run}@exam.test`;
  const users = [];
  const courses = [];
  let versionId = null;
  let examId = null;
  const attemptIds = [];

  try {
    const teacher = await createUser(
      service,
      email('results-teacher'),
      `Results Teacher ${run}`,
      password,
    );
    const otherTeacher = await createUser(
      service,
      email('results-other'),
      `Other Results Teacher ${run}`,
      password,
    );
    users.push(teacher.id, otherTeacher.id);
    await setRole(service, teacher.id, 'teacher');
    await setRole(service, otherTeacher.id, 'teacher');

    const teacherClient = await signIn(cfg, email('results-teacher'), password);
    const otherClient = await signIn(cfg, email('results-other'), password);

    const { data: created, error: createError } = await teacherClient.rpc('create_course', {
      p_title: 'Teacher results search verification',
      p_description: 'Literal wildcard, multi-attempt, and authorization checks',
      p_section: `R-${run}`,
      p_academic_term: '2026',
      p_course_code: `RESULTS${run.toUpperCase()}`,
    });
    assertNoError(createError, 'create_course');
    const courseId = created.course_id;
    courses.push(courseId);

    const now = new Date();
    const opensAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const closesAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const { data: exam, error: examError } = await service
      .from('exams')
      .insert({
        course_id: courseId,
        owner_id: teacher.id,
        title: `Results search exam ${run}`,
        duration_minutes: 60,
        opens_at: opensAt,
        closes_at: closesAt,
        state: 'draft',
      })
      .select('id')
      .single();
    assertNoError(examError, 'insert exam fixture');
    examId = exam.id;

    const { data: version, error: versionError } = await service
      .from('exam_versions')
      .insert({
        exam_id: examId,
        version_no: 1,
        title: `Results search exam ${run}`,
        duration_minutes: 60,
        opens_at: opensAt,
        closes_at: closesAt,
        result_release: 'immediate',
        frozen: false,
        published_by: teacher.id,
      })
      .select('id')
      .single();
    assertNoError(versionError, 'insert version fixture');
    versionId = version.id;

    const definitions = [
      {
        key: 'alpha',
        name: `Searchcase Alpha ${run}`,
        email: email('alpha'),
      },
      {
        key: 'bravo',
        name: `Searchcase Bravo O'Brien (100%_Test), Jr. ${run}`,
        email: email('bravo'),
      },
      {
        key: 'charlie',
        name: `searchcase charlie ${run}`,
        email: email('charlie'),
      },
      {
        key: 'delta',
        name: `Other Delta ${run}`,
        email: email('delta'),
      },
    ];

    const students = {};
    for (const definition of definitions) {
      const user = await createUser(service, definition.email, definition.name, password);
      users.push(user.id);
      students[definition.key] = user;
    }

    const deadlineAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const startedAt = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
    const submitted = {
      state: 'submitted',
      submitted_at: new Date(Date.UTC(2026, 0, 1, 0, 1, 0)).toISOString(),
      submission_reason: 'manual',
      earned_points: 8,
      max_points: 10,
      percentage: 80,
      answered_count: 10,
      correct_count: 8,
    };
    const inProgress = {
      state: 'in_progress',
      submitted_at: null,
      submission_reason: null,
      earned_points: null,
      max_points: null,
      percentage: null,
      answered_count: null,
      correct_count: null,
    };

    const attemptRows = [
      {
        exam_id: examId,
        exam_version_id: versionId,
        student_id: students.alpha.id,
        attempt_no: 1,
        started_at: startedAt(2),
        deadline_at: deadlineAt,
        ...submitted,
      },
      {
        exam_id: examId,
        exam_version_id: versionId,
        student_id: students.bravo.id,
        attempt_no: 1,
        started_at: startedAt(4),
        deadline_at: deadlineAt,
        ...submitted,
      },
      {
        exam_id: examId,
        exam_version_id: versionId,
        student_id: students.charlie.id,
        attempt_no: 1,
        started_at: startedAt(6),
        deadline_at: deadlineAt,
        ...inProgress,
      },
      {
        exam_id: examId,
        exam_version_id: versionId,
        student_id: students.bravo.id,
        attempt_no: 2,
        started_at: startedAt(8),
        deadline_at: deadlineAt,
        ...inProgress,
      },
      {
        exam_id: examId,
        exam_version_id: versionId,
        student_id: students.delta.id,
        attempt_no: 1,
        started_at: startedAt(2),
        deadline_at: deadlineAt,
        ...submitted,
      },
    ];

    const { data: insertedAttempts, error: attemptError } = await service
      .from('exam_attempts')
      .insert(attemptRows)
      .select('id');
    assertNoError(attemptError, 'insert attempt fixtures');
    attemptIds.push(...insertedAttempts.map((row) => row.id));

    const examRpc = (search = '', state = null, pageNo = 1, pageSize = 10) =>
      teacherClient.rpc('get_exam_attempts_page', {
        p_exam_id: examId,
        p_search: search,
        p_state: state,
        p_page: pageNo,
        p_page_size: pageSize,
      });
    const courseRpc = (search = '', state = null, pageNo = 1, pageSize = 10) =>
      teacherClient.rpc('get_course_attempts_page', {
        p_course_id: courseId,
        p_search: search,
        p_state: state,
        p_page: pageNo,
        p_page_size: pageSize,
      });

    await runner.check('empty search returns every attempt and an exact total', async () => {
      const data = page(await examRpc(), 'empty exam search');
      assert(data.total === 5, `expected total 5, got ${data.total}`);
      assert(data.rows.length === 5, `expected 5 rows, got ${data.rows.length}`);
      assert(data.rows.every((row) => row.exam_id === examId), 'rows escaped the exam');
      assert(
        data.rows.every((row) => row.student && row.student.full_name && row.student.email),
        'embedded student is missing',
      );
      assert(
        data.rows.every((row) => !('controller_token' in row)),
        'controller token leaked from the RPC',
      );
    });

    await runner.check('partial name search is case-insensitive', async () => {
      const data = page(await examRpc('SeArChCaSe'), 'partial name');
      assert(data.total === 4, `expected 4, got ${data.total}`);
      assert(
        data.rows.every((row) => /searchcase/i.test(row.student.full_name)),
        'wrong rows returned',
      );
      assert(!data.rows.some((row) => /delta/i.test(row.student.full_name)), 'delta leaked');
    });

    await runner.check('partial email search is case-insensitive', async () => {
      const data = page(await examRpc(`BRAVO.${run.toUpperCase()}`), 'email');
      assert(data.total === 2, `expected two attempt rows, got ${data.total}`);
      assert(
        data.rows.every((row) => row.student_id === students.bravo.id),
        'wrong student for email search',
      );
    });

    await runner.check('% is treated literally, not as a wildcard', async () => {
      const data = page(await examRpc('%'), 'percent literal');
      assert(data.total === 2, `expected two literal-percent attempts, got ${data.total}`);
      assert(
        data.rows.every((row) => row.student_id === students.bravo.id),
        'percent matched the wrong rows',
      );
    });

    await runner.check('_ is treated literally, not as a wildcard', async () => {
      const data = page(await examRpc('_'), 'underscore literal');
      assert(data.total === 2, `expected two literal-underscore attempts, got ${data.total}`);
      assert(
        data.rows.every((row) => row.student_id === students.bravo.id),
        'underscore matched the wrong rows',
      );
    });

    await runner.check('apostrophe, comma, and parentheses are safe literals', async () => {
      const data = page(await examRpc("O'Brien (100%_Test),"), 'special characters');
      assert(data.total === 2, `expected two attempts, got ${data.total}`);
      assert(
        data.rows.every((row) => row.student_id === students.bravo.id),
        'special-character match was wrong',
      );
    });

    await runner.check('state filter composes with search', async () => {
      const submittedRows = page(
        await examRpc('searchcase', 'submitted'),
        'submitted filter',
      );
      assert(submittedRows.total === 2, `expected 2 submitted, got ${submittedRows.total}`);
      assert(
        submittedRows.rows.every((row) => row.state === 'submitted'),
        'submitted filter leaked in-progress rows',
      );

      const inProgressRows = page(
        await examRpc('searchcase', 'in_progress'),
        'in-progress filter',
      );
      assert(inProgressRows.total === 2, `expected 2 in progress, got ${inProgressRows.total}`);
      assert(
        inProgressRows.rows.every((row) => row.state === 'in_progress'),
        'in-progress filter leaked submitted rows',
      );
    });

    await runner.check('multiple attempts are preserved and ordered stably', async () => {
      const data = page(await examRpc('bravo'), 'multiple attempts');
      assert(data.total === 2, `expected 2 attempts, got ${data.total}`);
      assert(
        JSON.stringify(data.rows.map((row) => row.attempt_no)) === JSON.stringify([2, 1]),
        'attempt rows are not newest-first',
      );
    });

    await runner.check('search applies before pagination without overlap', async () => {
      const pages = [];
      for (let pageNo = 1; pageNo <= 3; pageNo += 1) {
        pages.push(page(await examRpc('searchcase', null, pageNo, 2), `page ${pageNo}`));
      }
      assert(
        pages.every((data) => data.total === 4),
        'filtered total changed across pages',
      );
      assert(
        JSON.stringify(pages.map((data) => data.rows.length)) === JSON.stringify([2, 2, 0]),
        'page row counts are wrong',
      );
      const combined = pages.flatMap((data) => data.rows);
      assert(combined.length === 4, `expected 4 combined rows, got ${combined.length}`);
      assert(new Set(ids({ rows: combined })).size === 4, 'pagination returned duplicates');
      for (let i = 1; i < combined.length; i += 1) {
        assert(compareAttempts(combined[i - 1], combined[i]) <= 0, 'unstable result ordering');
      }
    });

    await runner.check('empty search result returns zero rows and zero count', async () => {
      const data = page(await examRpc('zzz-no-such-student'), 'empty result');
      assert(data.total === 0 && data.rows.length === 0, 'empty search was not empty');
    });

    await runner.check('clearing the search restores all rows', async () => {
      const data = page(await examRpc('', null, 1, 10), 'cleared search');
      assert(data.total === 5 && data.rows.length === 5, 'cleared search did not restore rows');
    });

    await runner.check('course results RPC searches the same authorized set', async () => {
      const all = page(await courseRpc(), 'course empty search');
      assert(all.total === 5 && all.rows.length === 5, 'course result set is wrong');
      const searched = page(await courseRpc('BRAVO', 'submitted'), 'course search');
      assert(searched.total === 1, `expected 1 submitted bravo attempt, got ${searched.total}`);
      assert(
        searched.rows[0].student_id === students.bravo.id && searched.rows[0].attempt_no === 1,
        'course search returned the wrong attempt',
      );
    });

    await runner.check('another teacher cannot use the exam results RPC', async () => {
      const result = await otherClient.rpc('get_exam_attempts_page', {
        p_exam_id: examId,
        p_search: '',
        p_state: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'cross-teacher exam search');
      assert(result.error.code === '42501', `expected 42501, got ${result.error.code}`);
    });

    await runner.check('another teacher cannot use the course results RPC', async () => {
      const result = await otherClient.rpc('get_course_attempts_page', {
        p_course_id: courseId,
        p_search: '',
        p_state: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'cross-teacher course search');
      assert(result.error.code === '42501', `expected 42501, got ${result.error.code}`);
    });

    await runner.check('students cannot use the exam results RPC', async () => {
      const studentClient = await signIn(cfg, definitions[0].email, password);
      const result = await studentClient.rpc('get_exam_attempts_page', {
        p_exam_id: examId,
        p_search: '',
        p_state: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'student exam search');
      assert(result.error.code === '42501', `expected 42501, got ${result.error.code}`);
    });

    await runner.check('anonymous callers cannot execute the RPC', async () => {
      const result = await anonClient(cfg).rpc('get_exam_attempts_page', {
        p_exam_id: examId,
        p_search: '',
        p_state: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'anonymous exam search');
    });
  } finally {
    if (attemptIds.length > 0) {
      await service.from('exam_attempts').delete().in('id', attemptIds);
    }
    if (versionId) {
      await service.from('exam_versions').delete().eq('id', versionId);
    }
    if (users.length > 0) {
      await service.from('audit_logs').delete().in('actor_id', users);
    }
    const leftovers = await bestEffortCleanup({ service, courses, users });
    reportLeftovers(leftovers);
  }

  const state = runner.report();
  process.exit(state.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Teacher results search failed: ${error.message}`);
  process.exit(1);
});
