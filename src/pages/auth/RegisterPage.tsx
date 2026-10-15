import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { errorMessage } from '../../lib/errors';
import { Alert, Button, Card, Field, TextInput } from '../../components/ui';
import { AuthLayout } from '../../components/AuthLayout';

export function RegisterPage() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const inFlight = useRef(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Synchronous guard: React state (`submitting`) is not yet applied on a
    // rapid double-click/Enter, so use a ref to guarantee a single request.
    if (inFlight.current) return;
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Please choose a stronger password (at least 8 characters).');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await signUp(email, password, fullName);
      setDone(true);
      if (!result.needsConfirmation) {
        window.location.assign('/');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1>Student registration</h1>
        <p className="muted small">
          Public registration always creates a <strong>student</strong> account. Teacher and
          administrator accounts are provisioned by an administrator.
        </p>
        {done ? (
          <Alert tone="success">
            Registration received. If email confirmation is enabled, check your inbox and confirm
            before signing in.
          </Alert>
        ) : null}
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        {!done ? (
          <form onSubmit={onSubmit} className="mt-2">
            <Field label="Full name" htmlFor="fullName">
              <TextInput
                id="fullName"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="regEmail">
              <TextInput
                id="regEmail"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="regPassword" hint="At least 8 characters.">
              <TextInput
                id="regPassword"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Confirm password" htmlFor="regConfirm">
              <TextInput
                id="regConfirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" block disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create student account'}
            </Button>
          </form>
        ) : null}
        <p className="mt-2 small">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
