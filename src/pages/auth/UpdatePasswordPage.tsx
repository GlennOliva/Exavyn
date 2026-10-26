import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import {
  clearRecoveryLocation,
  parseRecoveryLinkFailure,
  type RecoveryLinkFailure,
} from '../../features/auth/recovery';
import { errorMessage } from '../../lib/errors';
import { Alert, Button, Card, Field, TextInput } from '../../components/ui';
import { AuthLayout } from '../../components/AuthLayout';

const MISSING_SESSION: RecoveryLinkFailure = {
  code: 'missing_session',
  message:
    'This password reset link has expired or is no longer valid. Request a new reset email to continue.',
};

export function UpdatePasswordPage() {
  const { changePassword, session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [linkFailure, setLinkFailure] = useState<RecoveryLinkFailure | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseRecoveryLinkFailure(window.location.hash, window.location.search);
  });

  useEffect(() => {
    // The auth client must consume the implicit-flow fragment first. Once a
    // recovery session is ready (or the callback failed), remove the sensitive
    // token/error parameters from the address bar and browser history.
    if (linkFailure || (!loading && session)) clearRecoveryLocation();
  }, [linkFailure, loading, session]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(password);
      clearRecoveryLocation();
      setPassword('');
      setConfirm('');
      setUpdated(true);
    } catch (err) {
      const message = errorMessage(err);
      if (/session|expired|invalid/i.test(message)) {
        setError(MISSING_SESSION.message);
        setLinkFailure({ code: 'invalid_session', message: MISSING_SESSION.message });
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (updated) {
    return (
      <AuthLayout>
        <Card>
          <h1>Password updated</h1>
          <Alert tone="success">Your password was changed. Use it the next time you sign in.</Alert>
          <div className="row mt-2">
            <Link className="btn btn-primary" to="/">
              Continue
            </Link>
            <Link className="btn btn-ghost" to="/login">
              Back to sign in
            </Link>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  const failure = linkFailure ?? (!loading && !session ? MISSING_SESSION : null);

  if (loading) {
    return (
      <AuthLayout>
        <Card>
          <h1>Set a new password</h1>
          <p className="muted" role="status">
            Checking your reset link…
          </p>
        </Card>
      </AuthLayout>
    );
  }

  if (failure) {
    return (
      <AuthLayout>
        <Card>
          <h1>Reset link unavailable</h1>
          <Alert tone="danger" role="alert">
            {failure.message}
          </Alert>
          <p className="muted">
            For your security, recovery links are single-use and expire after a short time.
          </p>
          <Link className="btn btn-primary" to="/forgot-password">
            Request a new reset email
          </Link>
          <p className="mt-2 small">
            <Link to="/login">Back to sign in</Link>
          </p>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <h1>Set a new password</h1>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <form onSubmit={onSubmit}>
          <Field label="New password" htmlFor="newPassword">
            <div className="row" style={{ gap: 8 }}>
              <TextInput
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="button" variant="ghost" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword">
            <TextInput
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
