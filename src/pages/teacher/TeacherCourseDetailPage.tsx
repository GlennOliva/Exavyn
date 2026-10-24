import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import {
  decideEnrollment,
  deleteCourse,
  getCourse,
  getJoinCode,
  listCourseEnrollmentsPage,
  rotateJoinCode,
  setCourseArchived,
  updateCourse,
} from '../../features/courses/api';
import {
  archiveExam,
  deleteExam,
  duplicateExam,
  listExamsForCoursePage,
  publishExam,
  restoreExam,
} from '../../features/exams/api';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageSpinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useClampPage, usePageState } from '../../lib/pagination';
import { Pagination } from '../../components/Pagination';
import type { EnrollmentRow } from '../../lib/database.types';
import type { CourseRow } from '../../lib/database.types';

export function TeacherCourseDetailPage() {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [joinCodeInfo, setJoinCodeInfo] = useState<string | null>(null);

  const enrollmentsTable = usePageState('enrollments_');
  const examsTable = usePageState('exams_');
  const enrollmentStatus = (enrollmentsTable.getFilter('status') || 'all') as
    | 'all'
    | EnrollmentRow['status'];
  const examState = (examsTable.getFilter('state') || 'all') as
    | 'all'
    | 'draft'
    | 'published'
    | 'archived';

  const course = useAsync(() => getCourse(courseId), [courseId]);
  const enrollments = useAsync(
    () =>
      listCourseEnrollmentsPage(courseId, {
        page: enrollmentsTable.page,
        pageSize: enrollmentsTable.pageSize,
        q: enrollmentsTable.q,
        status: enrollmentStatus,
      }),
    [courseId, enrollmentsTable.page, enrollmentsTable.pageSize, enrollmentsTable.q, enrollmentStatus],
  );
  const exams = useAsync(
    () =>
      listExamsForCoursePage(courseId, {
        page: examsTable.page,
        pageSize: examsTable.pageSize,
        q: examsTable.q,
        state: examState,
      }),
    [courseId, examsTable.page, examsTable.pageSize, examsTable.q, examState],
  );
  useClampPage(enrollmentsTable.page, enrollmentsTable.pageSize, enrollments.data?.total ?? 0, enrollmentsTable.setPage);
  useClampPage(examsTable.page, examsTable.pageSize, exams.data?.total ?? 0, examsTable.setPage);
  const enrollmentRows = enrollments.data?.rows ?? [];
  const examRows = exams.data?.rows ?? [];

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setActionError(null);
    try {
      await fn();
      setNotice(message);
      await Promise.all([enrollments.reload(), exams.reload(), course.reload()]);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const revealJoinCode = async () => {
    setActionError(null);
    try {
      const info = await getJoinCode(courseId);
      if (!info.present) {
        setJoinCodeInfo('No active join code. Generate one below.');
      } else if (info.legacy || !info.code) {
        setJoinCodeInfo(
          `This code was created before retrievable codes existed (hint: ${info.code_hint ?? 'n/a'}). Regenerate to get a readable code.`,
        );
      } else {
        setJoinCode(info.code);
        setJoinCodeInfo(null);
      }
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const removeCourse = async () => {
    if (!window.confirm('Delete this course permanently? This only works when it has no exams or enrollments.')) {
      return;
    }
    setActionError(null);
    try {
      await deleteCourse(courseId);
      navigate('/teacher/courses', { replace: true });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  if (course.loading) return <PageSpinner />;
  if (course.error) return <Alert tone="danger" role="alert">{course.error}</Alert>;
  if (!course.data) return <Alert tone="warning">Course not found.</Alert>;

  const c = course.data;

  return (
    <div className="stack">
      <Link to="/teacher/courses" className="small">
        ← All courses
      </Link>
      <div className="row-between">
        <div>
          <h1>
            {c.course_code} · {c.title}
          </h1>
          <p className="muted">
            {c.section || 'No section'} · {c.academic_term || 'No term'} ·{' '}
            <StatusBadge status={c.archived ? 'archived' : 'active'} />
          </p>
        </div>
        <div className="row">
          <Button size="sm" onClick={() => setShowEdit(true)}>
            Edit details
          </Button>
          <Button size="sm" onClick={() => void revealJoinCode()}>
            Show join code
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(
                async () => {
                  const code = await rotateJoinCode(courseId);
                  setJoinCode(code);
                  setJoinCodeInfo(null);
                },
                'New join code generated (previous code deactivated).',
              )
            }
          >
            Regenerate code
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(
                () => setCourseArchived(courseId, !c.archived),
                c.archived ? 'Course restored.' : 'Course archived.',
              )
            }
          >
            {c.archived ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void removeCourse()}>
            Delete
          </Button>
        </div>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="danger" role="alert">{actionError}</Alert> : null}
      {joinCode ? (
        <Alert tone="info">
          Current join code: <strong>{joinCode}</strong>
        </Alert>
      ) : null}
      {joinCodeInfo ? <Alert tone="warning">{joinCodeInfo}</Alert> : null}

      <Card>
        <div className="row-between">
          <h2>Enrollments</h2>
          {enrollments.data ? (
            <span className="muted small">{enrollments.data.total} record(s)</span>
          ) : null}
        </div>
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search enrollments"
            placeholder="Search students by name or email…"
            value={enrollmentsTable.q}
            onChange={(e) => enrollmentsTable.setQuery(e.target.value)}
          />
          <select
            aria-label="Filter enrollment status"
            value={enrollmentStatus}
            onChange={(e) =>
              enrollmentsTable.setFilter('status', e.target.value === 'all' ? '' : e.target.value)
            }
          >
            <option value="all">All statuses</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="withdrawn">withdrawn</option>
          </select>
        </div>
        {enrollments.loading ? <PageSpinner /> : null}
        {enrollments.error ? <Alert tone="danger">{enrollments.error}</Alert> : null}
        {enrollments.data && enrollmentRows.length === 0 ? (
          <EmptyState title="No enrollment requests match">
            <p className="muted">Share the join code with your students.</p>
          </EmptyState>
        ) : null}
        {enrollmentRows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollmentRows.map((enr) => (
                  <tr key={enr.id}>
                    <td>
                      {enr.student?.full_name || '—'}
                      <div className="small muted">{enr.student?.email}</div>
                    </td>
                    <td>
                      <StatusBadge status={enr.status} />
                    </td>
                    <td className="small muted">{formatDateTime(enr.requested_at)}</td>
                    <td>
                      <div className="row">
                        {enr.status !== 'approved' ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              void run(
                                () => decideEnrollment(enr.id, 'approved'),
                                'Enrollment approved.',
                              )
                            }
                          >
                            Approve
                          </Button>
                        ) : null}
                        {enr.status !== 'rejected' ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              void run(
                                () => decideEnrollment(enr.id, 'rejected'),
                                'Enrollment rejected.',
                              )
                            }
                          >
                            Reject
                          </Button>
                        ) : null}
                        {enr.status === 'approved' ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              void run(
                                () => decideEnrollment(enr.id, 'withdrawn'),
                                'Enrollment withdrawn.',
                              )
                            }
                          >
                            Withdraw
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {enrollments.data ? (
          <Pagination
            label="enrollments"
            page={enrollmentsTable.page}
            pageSize={enrollmentsTable.pageSize}
            total={enrollments.data.total}
            onPageChange={enrollmentsTable.setPage}
            onPageSizeChange={enrollmentsTable.setPageSize}
          />
        ) : null}
      </Card>

      <Card>
        <div className="row-between">
          <h2>Examinations</h2>
          <Link className="btn btn-primary btn-sm" to={`/teacher/exams/new?course=${courseId}`}>
            New exam
          </Link>
        </div>
        <div className="row">
          <TextInput
            type="search"
            aria-label="Search examinations"
            placeholder="Search by title…"
            value={examsTable.q}
            onChange={(e) => examsTable.setQuery(e.target.value)}
          />
          <select
            aria-label="Filter exam state"
            value={examState}
            onChange={(e) =>
              examsTable.setFilter('state', e.target.value === 'all' ? '' : e.target.value)
            }
          >
            <option value="all">All states</option>
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </div>
        {exams.loading ? <PageSpinner /> : null}
        {exams.error ? <Alert tone="danger">{exams.error}</Alert> : null}
        {exams.data && examRows.length === 0 ? (
          <EmptyState title="No exams match">
            <p className="muted">Create a draft, add questions, then publish it.</p>
          </EmptyState>
        ) : null}
        {examRows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>State</th>
                  <th>Duration</th>
                  <th>Attempts</th>
                  <th>Window</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {examRows.map((exam) => (
                  <tr key={exam.id}>
                    <td>{exam.title}</td>
                    <td>
                      <StatusBadge status={exam.archived ? 'archived' : exam.state} />
                    </td>
                    <td>{exam.duration_minutes} min</td>
                    <td className="small muted">{exam.max_attempts}</td>
                    <td className="small muted">
                      {formatDateTime(exam.opens_at)} → {formatDateTime(exam.closes_at)}
                    </td>
                    <td>
                      <div className="row">
                        {exam.state === 'draft' ? (
                          <>
                            <Link
                              className="btn btn-sm"
                              to={`/teacher/exams/${exam.id}/edit`}
                            >
                              Edit
                            </Link>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() =>
                                void run(
                                  async () => {
                                    await publishExam(exam.id);
                                  },
                                  'Exam published.',
                                )
                              }
                            >
                              Publish
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                void run(
                                  async () => {
                                    await deleteExam(exam.id);
                                  },
                                  'Draft exam deleted.',
                                )
                              }
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                        {exam.state === 'published' ? (
                          <>
                            <Link
                              className="btn btn-sm"
                              to={`/teacher/exams/${exam.id}/results`}
                            >
                              Results
                            </Link>
                            <Link
                              className="btn btn-sm"
                              to={`/teacher/exams/${exam.id}/edit`}
                            >
                              Settings
                            </Link>
                            <Button
                              size="sm"
                              onClick={() =>
                                void run(
                                  async () => {
                                    await archiveExam(exam.id);
                                  },
                                  'Exam archived.',
                                )
                              }
                            >
                              Archive
                            </Button>
                          </>
                        ) : null}
                        {exam.state === 'archived' ? (
                          <>
                            <Link
                              className="btn btn-sm"
                              to={`/teacher/exams/${exam.id}/results`}
                            >
                              Results
                            </Link>
                            <Button
                              size="sm"
                              onClick={() =>
                                void run(
                                  async () => {
                                    await restoreExam(exam.id);
                                  },
                                  'Exam restored.',
                                )
                              }
                            >
                              Restore
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              async () => {
                                await duplicateExam(exam.id);
                              },
                              'Duplicated into a new draft.',
                            )
                          }
                        >
                          Duplicate
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {exams.data ? (
          <Pagination
            label="examinations"
            page={examsTable.page}
            pageSize={examsTable.pageSize}
            total={exams.data.total}
            onPageChange={examsTable.setPage}
            onPageSizeChange={examsTable.setPageSize}
          />
        ) : null}
      </Card>

      {showEdit ? (
        <EditCourseModal
          course={c}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            setNotice('Course details updated.');
            await course.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function EditCourseModal({
  course,
  onClose,
  onSaved,
}: {
  course: CourseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [section, setSection] = useState(course.section);
  const [academicTerm, setAcademicTerm] = useState(course.academic_term);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateCourse(course.id, {
        title,
        description,
        section,
        academic_term: academicTerm,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit course" onClose={onClose}>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <Field label="Title" htmlFor="cTitle">
        <TextInput id="cTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="cDescription">
        <TextArea
          id="cDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="row">
        <div className="grow">
          <Field label="Section" htmlFor="cSection">
            <TextInput id="cSection" value={section} onChange={(e) => setSection(e.target.value)} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Academic term" htmlFor="cTerm">
            <TextInput
              id="cTerm"
              value={academicTerm}
              onChange={(e) => setAcademicTerm(e.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !title.trim()}>
          Save
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
