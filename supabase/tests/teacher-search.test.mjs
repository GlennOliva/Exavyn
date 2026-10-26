#!/usr/bin/env node
/**
 * Hosted teacher enrollment search verification.
 *
 * Creates an isolated teacher/course with students whose names and emails cover
 * literal wildcard characters, then exercises the parameterized RPC with real
 * user tokens. No existing user, enrollment, attempt, answer, or result is
 * modified. All mutable fixtures are removed at the end.
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
const runner = createRunner('Teacher enrollment search');

function page(result, context) {
  assertNoError(result.error, context);
  const data = result.data;
  assert(data && Array.isArray(data.rows), `${context}: expected rows array`);
  assert(typeof data.total === 'number', `${context}: expected numeric total`);
  return data;
}

function ids(data) {
  return data.rows.map((row) => row.student_id);
}

async function main() {
  const run = shortId();
  const password = `Search-${run}-Aa1`;
  const teacherEmail = `search-teacher-${run}@exam.test`;
  const otherTeacherEmail = `search-other-${run}@exam.test`;
  const users = [];
  const courses = [];
  let teacherId;
  let courseId;
  let students = [];

  try {
    const teacher = await createUser(service, teacherEmail, `Search Teacher ${run}`, password);
    const otherTeacher = await createUser(
      service,
      otherTeacherEmail,
      `Other Teacher ${run}`,
      password,
    );
    teacherId = teacher.id;
    users.push(teacherId, otherTeacher.id);
    await setRole(service, teacherId, 'teacher');
    await setRole(service, otherTeacher.id, 'teacher');

    const teacherClient = await signIn(cfg, teacherEmail, password);
    const otherClient = await signIn(cfg, otherTeacherEmail, password);

    const { data: created, error: createError } = await teacherClient.rpc('create_course', {
      p_title: 'Teacher search verification',
      p_description: 'Literal wildcard and authorization checks',
      p_section: `S-${run}`,
      p_academic_term: '2026',
      p_course_code: `SEARCH${run.toUpperCase()}`,
    });
    assertNoError(createError, 'create_course');
    courseId = created.course_id;
    courses.push(courseId);

    const definitions = [
      {
        name: `Searchcase Alpha ${run}`,
        email: `alpha.${run}@exam.test`,
        status: 'approved',
      },
      {
        name: `Searchcase Bravo O'Brien (100%_Test), Jr. ${run}`,
        email: `bravo.${run}@exam.test`,
        status: 'pending',
      },
      {
        name: `searchcase charlie ${run}`,
        email: `charlie.${run}@exam.test`,
        status: 'rejected',
      },
      {
        name: `Other Delta ${run}`,
        email: `delta.${run}@exam.test`,
        status: 'approved',
      },
    ];

    for (const definition of definitions) {
      const user = await createUser(service, definition.email, definition.name, password);
      users.push(user.id);
      const studentClient = await signIn(cfg, definition.email, password);
      const { data: enrollment, error: enrollError } = await studentClient.rpc(
        'request_enrollment',
        { p_join_code: created.join_code },
      );
      assertNoError(enrollError, `request_enrollment ${definition.email}`);
      if (definition.status !== 'pending') {
        const { error: decideError } = await teacherClient.rpc('decide_enrollment', {
          p_enrollment_id: enrollment.enrollment_id,
          p_decision: definition.status,
        });
        assertNoError(decideError, `decide_enrollment ${definition.status}`);
      }
      students.push({ ...definition, id: user.id, enrollmentId: enrollment.enrollment_id });
    }

    const rpc = (search = '', status = null, pageNo = 1, pageSize = 10) =>
      teacherClient.rpc('get_course_enrollments_page', {
        p_course_id: courseId,
        p_search: search,
        p_status: status,
        p_page: pageNo,
        p_page_size: pageSize,
      });

    await runner.check('empty search returns all authorized enrollments and exact total', async () => {
      const data = page(await rpc(), 'empty search');
      assert(data.total === 4, `expected total 4, got ${data.total}`);
      assert(data.rows.length === 4, `expected 4 rows, got ${data.rows.length}`);
      assert(data.rows.every((row) => row.course_id === courseId), 'rows escaped the course');
    });

    await runner.check('partial name search is case-insensitive', async () => {
      const data = page(await rpc('SeArChCaSe'), 'partial name');
      assert(data.total === 3, `expected 3, got ${data.total}`);
      assert(data.rows.every((row) => /searchcase/i.test(row.student_full_name)), 'wrong rows');
      assert(!data.rows.some((row) => /delta/i.test(row.student_full_name)), 'delta leaked');
    });

    await runner.check('partial email search is case-insensitive', async () => {
      const data = page(await rpc(`BRAVO.${run.toUpperCase()}`), 'email');
      assert(data.total === 1, `expected 1, got ${data.total}`);
      assert(data.rows[0].student_id === students[1].id, 'wrong student for email search');
    });

    await runner.check('% is treated literally, not as a wildcard', async () => {
      const data = page(await rpc('%'), 'percent literal');
      assert(data.total === 1, `expected one literal-percent match, got ${data.total}`);
      assert(data.rows[0].student_id === students[1].id, 'percent matched the wrong row');
    });

    await runner.check('_ is treated literally, not as a wildcard', async () => {
      const data = page(await rpc('_'), 'underscore literal');
      assert(data.total === 1, `expected one literal-underscore match, got ${data.total}`);
      assert(data.rows[0].student_id === students[1].id, 'underscore matched the wrong row');
    });

    await runner.check('apostrophe, comma, and parentheses are safe literals', async () => {
      const data = page(await rpc("O'Brien (100%_Test),"), 'special characters');
      assert(data.total === 1, `expected 1, got ${data.total}`);
      assert(data.rows[0].student_id === students[1].id, 'special-character match was wrong');
    });

    await runner.check('status filter composes with search', async () => {
      const approved = page(await rpc('searchcase', 'approved'), 'approved filter');
      assert(approved.total === 1, `expected 1 approved, got ${approved.total}`);
      assert(approved.rows[0].student_id === students[0].id, 'approved row mismatch');
      const rejected = page(await rpc('searchcase', 'rejected'), 'rejected filter');
      assert(rejected.total === 1, `expected 1 rejected, got ${rejected.total}`);
      assert(rejected.rows[0].student_id === students[2].id, 'rejected row mismatch');
      const pending = page(await rpc('other', 'pending'), 'pending filter');
      assert(pending.total === 0, `expected 0 pending, got ${pending.total}`);
    });

    await runner.check('search applies before pagination with stable ordering', async () => {
      const first = page(await rpc('searchcase', null, 1, 2), 'page 1');
      const second = page(await rpc('searchcase', null, 2, 2), 'page 2');
      assert(first.total === 3 && second.total === 3, 'filtered total changed across pages');
      assert(first.rows.length === 2 && second.rows.length === 1, 'page sizes are wrong');
      for (let i = 1; i < first.rows.length; i += 1) {
        const previous = Date.parse(first.rows[i - 1].requested_at);
        const current = Date.parse(first.rows[i].requested_at);
        assert(previous >= current, 'page is not ordered by requested_at descending');
      }
      const overlap = ids(first).filter((id) => ids(second).includes(id));
      assert(overlap.length === 0, 'pagination returned overlapping rows');
    });

    await runner.check('empty search result returns zero rows and zero count', async () => {
      const data = page(await rpc('zzz-no-such-student'), 'empty result');
      assert(data.total === 0 && data.rows.length === 0, 'empty search was not empty');
    });

    await runner.check('clearing the search restores all rows', async () => {
      const data = page(await rpc('', null, 1, 10), 'cleared search');
      assert(data.total === 4 && data.rows.length === 4, 'cleared search did not restore rows');
    });

    await runner.check('another teacher cannot use the RPC for this course', async () => {
      const result = await otherClient.rpc('get_course_enrollments_page', {
        p_course_id: courseId,
        p_search: '',
        p_status: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'cross-teacher search');
      assert(result.error.code === '42501', `expected 42501, got ${result.error.code}`);
    });

    await runner.check('anonymous callers cannot execute the RPC', async () => {
      const result = await anonClient(cfg).rpc('get_course_enrollments_page', {
        p_course_id: courseId,
        p_search: '',
        p_status: null,
        p_page: 1,
        p_page_size: 10,
      });
      assertRpcError(result, 'anonymous search');
    });
  } finally {
    if (users.length > 0) {
      // Course creation/decisions write audit rows whose actor FK is not
      // cascaded. These are disposable test artifacts, so remove their audit
      // trail before deleting the fixture users.
      await service.from('audit_logs').delete().in('actor_id', users);
    }
    const leftovers = await bestEffortCleanup({ service, courses, users });
    reportLeftovers(leftovers);
  }

  const state = runner.report();
  process.exit(state.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Teacher enrollment search failed: ${error.message}`);
  process.exit(1);
});
