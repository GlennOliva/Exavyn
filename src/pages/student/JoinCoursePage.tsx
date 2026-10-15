import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestEnrollment } from '../../features/courses/api';
import { Alert, Button, Card, Field, TextInput } from '../../components/ui';
import { errorMessage } from '../../lib/errors';

export function JoinCoursePage() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestEnrollment(code);
      setMessage(
        result.already
          ? `You already have a ${result.status} enrollment for this course.`
          : 'Request submitted. Your teacher must approve it before exams appear.',
      );
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="narrow stack">
      <h1>Join a course</h1>
      <Card>
        <p className="muted">
          Enter the enrollment <strong>join code</strong> provided by your teacher. Course
          identifiers such as IT101 do not grant enrollment.
        </p>
        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={submit}>
          <Field label="Join code" htmlFor="joinCode" hint="Case-insensitive.">
            <TextInput
              id="joinCode"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AB12CD34"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Submitting…' : 'Request enrollment'}
          </Button>
        </form>
        <p className="mt-2 small">
          <Link to="/student">Back to dashboard</Link>
        </p>
      </Card>
    </div>
  );
}
