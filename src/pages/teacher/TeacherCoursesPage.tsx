import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { createCourse, listTeacherCourses } from '../../features/courses/api';
import {
  Alert,
  Button,
  Field,
  Modal,
  PageSpinner,
  StatusBadge,
  TextInput,
  TextArea,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';

export function TeacherCoursesPage() {
  const { data, loading, error, reload } = useAsync(() => listTeacherCourses(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="row-between">
        <h1>My courses</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          New course
        </Button>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {loading ? <PageSpinner /> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      {data && data.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Section</th>
                <th>Term</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((course) => (
                <tr key={course.id}>
                  <td className="mono">{course.course_code}</td>
                  <td>{course.title}</td>
                  <td>{course.section || '—'}</td>
                  <td>{course.academic_term || '—'}</td>
                  <td>
                    <StatusBadge status={course.archived ? 'archived' : 'active'} />
                  </td>
                  <td>
                    <Link className="btn btn-sm" to={`/teacher/courses/${course.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showCreate ? (
        <CreateCourseModal
          onClose={() => setShowCreate(false)}
          onCreated={(code) => {
            setShowCreate(false);
            setNotice(`Course created. Share join code: ${code}`);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateCourseModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (joinCode: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [section, setSection] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createCourse({
        title,
        description,
        section,
        academicTerm: term,
        courseCode: code.toUpperCase(),
      });
      onCreated(result.join_code);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Create course" onClose={onClose}>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <Alert tone="info">
        The <strong>course code</strong> (e.g. IT101) identifies the course but does not grant
        enrollment. A separate join code is generated for students.
      </Alert>
      <form onSubmit={submit} className="mt-2">
        <Field label="Title" htmlFor="cTitle">
          <TextInput id="cTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Course code" htmlFor="cCode" hint="2–16 characters: letters, digits, hyphen.">
          <TextInput
            id="cCode"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="IT101"
          />
        </Field>
        <Field label="Description" htmlFor="cDesc">
          <TextArea id="cDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="row">
          <div className="grow">
            <Field label="Section" htmlFor="cSection">
              <TextInput id="cSection" value={section} onChange={(e) => setSection(e.target.value)} />
            </Field>
          </div>
          <div className="grow">
            <Field label="Academic term" htmlFor="cTerm">
              <TextInput id="cTerm" value={term} onChange={(e) => setTerm(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="row-between">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create course'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
